import { spawn } from 'node:child_process'
import net from 'node:net'
import type { Alert, Device, Metric, MonitoringDiagnostic, Status } from '../types.js'
import { HotspotTrafficService, type HotspotClient, type HotspotSnapshot } from './hotspot.js'
import { assertTargetSyntax, isConfiguredAddressAllowed, isConfiguredHostname, validateTarget } from './target-policy.js'

const now = () => new Date().toISOString()
const round = (value: number, digits = 2) => +value.toFixed(digits)
function run(command: string, args: string[], timeout = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, shell: false })
    let output = ''; let error = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${command} timed out`)) }, timeout)
    child.stdout.on('data', chunk => { output += chunk.toString() })
    child.stderr.on('data', chunk => { error += chunk.toString() })
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('close', () => { clearTimeout(timer); resolve(output || error) })
  })
}

let lastTrafficSample: { time: number; rxBytes: number; txBytes: number } | null = null

async function localTraffic(): Promise<{ downloadMbps: number; uploadMbps: number }> {
  if (process.platform === 'win32') {
    // Windows exposes instantaneous interface byte rates through this performance class.
    const command = "$a=Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface | Where-Object {$_.Name -notmatch 'Loopback|Teredo|isatap'}; @{received=(($a | Measure-Object BytesReceivedPersec -Sum).Sum);sent=(($a | Measure-Object BytesSentPersec -Sum).Sum)} | ConvertTo-Json -Compress"
    try {
      const raw = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], 15000)
      const rates = JSON.parse(raw) as { received?: number; sent?: number }
      return { downloadMbps: round(((rates.received || 0) * 8) / 1_000_000), uploadMbps: round(((rates.sent || 0) * 8) / 1_000_000) }
    } catch { return { downloadMbps: 0, uploadMbps: 0 } }
  }

  // Linux: read /proc/net/dev
  try {
    const fs = await import('node:fs/promises')
    const content = await fs.readFile('/proc/net/dev', 'utf8')
    let totalRx = 0
    let totalTx = 0
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('Inter-') || trimmed.startsWith('face') || trimmed.startsWith('lo:')) continue
      const parts = trimmed.split(/\s+/)
      if (parts.length >= 10) {
        totalRx += Number(parts[1]) || 0
        totalTx += Number(parts[9]) || 0
      }
    }
    const currentTime = Date.now()
    if (!lastTrafficSample) {
      lastTrafficSample = { time: currentTime, rxBytes: totalRx, txBytes: totalTx }
      return { downloadMbps: 0, uploadMbps: 0 }
    }
    const timeDiffSec = (currentTime - lastTrafficSample.time) / 1000
    if (timeDiffSec <= 0) return { downloadMbps: 0, uploadMbps: 0 }
    const rxRate = Math.max(0, (totalRx - lastTrafficSample.rxBytes) / timeDiffSec)
    const txRate = Math.max(0, (totalTx - lastTrafficSample.txBytes) / timeDiffSec)
    lastTrafficSample = { time: currentTime, rxBytes: totalRx, txBytes: totalTx }
    return {
      downloadMbps: round((rxRate * 8) / 1_000_000),
      uploadMbps: round((txRate * 8) / 1_000_000)
    }
  } catch {
    return { downloadMbps: 0, uploadMbps: 0 }
  }
}

import os from 'node:os'

async function physicalNetworkOnline(): Promise<boolean> {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    if (name.toLowerCase().includes('loopback') || name.toLowerCase().includes('pseudo')) continue
    const addresses = interfaces[name]
    if (addresses && addresses.some(iface => !iface.internal && iface.family === 'IPv4')) {
      return true
    }
  }
  return false
}
const isLoopback = (address: string) => address === 'localhost' || address === '::1' || /^127\./.test(address)

export const parsePingOutput = (output: string) => {
  const receivedMatch = output.match(/Received\s*=\s*(\d+)/i) || output.match(/(\d+)\s+(?:packets\s+)?received/i)
  const received = Number(receivedMatch?.[1] || 0)
  const lossMatch = output.match(/\((\d+)%\s*loss\)/i) || output.match(/(\d+(?:\.\d+)?)%\s*(?:packet\s+)?loss/i)
  const loss = lossMatch ? Number(lossMatch[1]) : (100 - (received / 4) * 100)
  const samples = [...output.matchAll(/time[=<]\s*([\d.]+)\s*ms/gi)].map(match => Number(match[1]))
  const avgMatch = output.match(/Average\s*=\s*(\d+)ms/i) || output.match(/rtt [^=]+=\s*[\d.]+\/([\d.]+)\//i)
  const average = Number(avgMatch?.[1] || (samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : 0))
  return { received, loss, average }
}

async function probe(address: string): Promise<{ status: Status; metric: Metric; errorMessage?: string }> {
  const count = 4
  if (isLoopback(address) && !(await physicalNetworkOnline())) return { status: 'offline', metric: { timestamp: now(), latencyMs: 0, packetLossPercent: 100, downloadMbps: 0, uploadMbps: 0, availabilityPercent: 0, errorCount: count, responseTimeMs: 0 }, errorMessage: 'No active physical IPv4 network interface.' }
  try {
    await validateTarget(address)
    const isWin = process.platform === 'win32'
    const pingArgs = isWin
      ? ['-n', String(count), '-w', '1000', address]
      : ['-c', String(count), '-W', '1', address]
    const output = await run('ping', pingArgs, 6500)
    const { received, loss, average } = parsePingOutput(output)
    const traffic = await localTraffic()
    const online = received > 0
    const status: Status = !online ? 'offline' : average > 100 || loss > 1 ? 'warning' : 'online'
    return { status, metric: { timestamp: now(), latencyMs: round(average || (online ? 1 : 0), 1), packetLossPercent: round(loss, 2), downloadMbps: traffic.downloadMbps, uploadMbps: traffic.uploadMbps, availabilityPercent: round(received / count * 100, 2), errorCount: count - received, responseTimeMs: round(average || (online ? 1 : 0), 1) }, errorMessage: online ? undefined : `Ping failed: ${loss}% packet loss.` }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ping probe failed.'
    return { status: 'offline', metric: { timestamp: now(), latencyMs: 0, packetLossPercent: 100, downloadMbps: 0, uploadMbps: 0, availabilityPercent: 0, errorCount: count, responseTimeMs: 0 }, errorMessage: message }
  }
}

export class LiveMonitoringService {
  devices: Device[] = []; metrics = new Map<number, Metric[]>(); alerts: Alert[] = []; diagnostics: MonitoringDiagnostic[] = []; private alertId = 1
  private latencyThreshold = 100
  private hotspotTraffic = new HotspotTrafficService()
  private hotspotClients: HotspotClient[] = []
  constructor() {
    const configuredTargets = (process.env.MONITORED_TARGETS || '').split(',').map(value => value.trim()).filter(Boolean)
    configuredTargets.forEach(address => {
      const normalized = assertTargetSyntax(address)
      if (net.isIPv4(normalized) && !isConfiguredAddressAllowed(normalized)) throw new Error(`Target ${address} is outside the configured monitoring policy`)
      if (!net.isIPv4(normalized) && !isConfiguredHostname(normalized) && process.env.ALLOW_PUBLIC_TARGETS !== 'true') {
        throw new Error(`Hostname ${address} is not included in MONITORING_ALLOWED_HOSTNAMES`)
      }
    })
    const targets = configuredTargets
    targets.forEach((address, index) => this.addDevice({ name: address === '127.0.0.1' ? 'This computer' : `Target-${index + 1}`, address, type: 'Computer', location: 'Real network', monitoringInterval: Number(process.env.MONITORING_INTERVAL_SECONDS || 30) }))
  }
  hydrate(devices: Device[], metrics: Map<number, Metric[]>, alerts: Alert[]) { if (!devices.length) return; this.devices=devices; this.metrics=metrics; this.alerts=alerts; this.devices.forEach(device => { const history=this.metrics.get(device.id) || []; if (history.length) { device.latest=history.at(-1)!; device.lastChecked=device.latest.timestamp } }); this.alertId=Math.max(0,...alerts.map(alert=>alert.id))+1 }
  getDevice(id: number) { const device = this.devices.find(item => item.id === id); if (!device) throw Object.assign(new Error('Device not found'), { status: 404 }); return device }
  addDevice(input: Partial<Device>) {
    const address = input.address?.trim() || ''
    assertTargetSyntax(address)
    if (net.isIPv4(address) && !isConfiguredAddressAllowed(address)) throw Object.assign(new Error('Target is outside the configured monitoring policy.'), { status: 400 })
    if (!net.isIPv4(address) && !isConfiguredHostname(address) && process.env.ALLOW_PUBLIC_TARGETS !== 'true') throw Object.assign(new Error('Hostname is not included in MONITORING_ALLOWED_HOSTNAMES.'), { status: 400 })
    if (this.devices.some(device => device.address.toLowerCase() === address.toLowerCase())) throw Object.assign(new Error('This address is already monitored.'), { status: 409 })
    const id = Math.max(...this.devices.map(device => device.id), 0) + 1
    const metric: Metric = { timestamp: now(), latencyMs: 0, packetLossPercent: 0, downloadMbps: 0, uploadMbps: 0, availabilityPercent: 0, errorCount: 0, responseTimeMs: 0 }
    const device: Device = { id, name: input.name || address, address, type: input.type || 'Computer', location: input.location || 'Real network', status: 'warning', monitoringInterval: input.monitoringInterval || 30, createdAt: now(), lastChecked: now(), latest: metric }
    this.devices.push(device); this.metrics.set(id, [metric]); return device
  }
  async check(id: number) {
    const device = this.getDevice(id); const result = await probe(device.address)
    const hotspotClient = this.hotspotClients.find(client => client.ip === device.address)
    if (hotspotClient) {
      result.metric.downloadMbps = hotspotClient.downloadMbps
      result.metric.uploadMbps = hotspotClient.uploadMbps
    }
    device.status = result.status; device.latest = result.metric; device.lastChecked = result.metric.timestamp
    const records = this.metrics.get(id) || []; records.push(result.metric); this.metrics.set(id, records.slice(-2016))
    this.diagnostics.unshift({ deviceId: id, timestamp: result.metric.timestamp, result: result.errorMessage ? 'failure' : 'success', responseTimeMs: result.metric.responseTimeMs, message: result.errorMessage })
    this.diagnostics = this.diagnostics.slice(0, 200)
    this.evaluate(device, result.metric); return result.metric
  }
  async tick() {
    const hotspot = await this.hotspotTraffic.snapshot()
    this.hotspotClients = hotspot.clients
    for (const client of this.hotspotClients) {
      if (!this.devices.some(d => d.address === client.ip)) {
        try {
          this.addDevice({ name: `Hotspot Device (${client.mac})`, address: client.ip, type: 'Computer', location: client.interface })
        } catch (e) {
          console.error('Error adding hotspot device:', e)
        }
      }
    }
    await Promise.all(this.devices.map(device => this.check(device.id)))
  }
  async refreshTraffic() {
    const traffic = await localTraffic()
    const networkOnline = await physicalNetworkOnline()
    const hotspot = await this.hotspotTraffic.snapshot()
    this.hotspotClients = hotspot.clients
    for (const device of this.devices) {
      const hotspotClient = this.hotspotClients.find(client => client.ip === device.address)
      if (!networkOnline) device.status = 'offline'
      const metric = { ...device.latest, timestamp: now(), latencyMs: networkOnline ? device.latest.latencyMs : 0, packetLossPercent: networkOnline ? device.latest.packetLossPercent : 100, availabilityPercent: networkOnline ? device.latest.availabilityPercent : 0, errorCount: networkOnline ? device.latest.errorCount : 4, downloadMbps: hotspotClient ? hotspotClient.downloadMbps : traffic.downloadMbps, uploadMbps: hotspotClient ? hotspotClient.uploadMbps : traffic.uploadMbps }
      device.latest = metric; device.lastChecked = metric.timestamp
      const records = this.metrics.get(device.id) || []
      records.push(metric); this.metrics.set(device.id, records.slice(-2016))
    }
  }
  async runScenario() { await this.tick(); return 0 }
  async getHotspotSnapshot(): Promise<HotspotSnapshot> { const snapshot = await this.hotspotTraffic.snapshot(); this.hotspotClients = snapshot.clients; return snapshot }
  stop() { this.hotspotTraffic.stop() }
  setLatencyThreshold(threshold: number) { this.latencyThreshold = threshold }
  updateAlert(id: number, status: 'acknowledged' | 'resolved') { const alert = this.alerts.find(item => item.id === id); if (!alert) throw Object.assign(new Error('Alert not found'), { status: 404 }); alert.status = status; return alert }
  private evaluate(device: Device, metric: Metric) {
    const checks: [string, number, number, string][] = [['latencyMs', metric.latencyMs, this.latencyThreshold, 'High latency'], ['packetLossPercent', metric.packetLossPercent, 3, 'High packet loss']]
    if (device.status === 'offline') checks.push(['availabilityPercent', 0, 95, 'Device offline'])
    for (const [metricName, value, threshold, label] of checks) {
      const matches = metricName === 'availabilityPercent' ? value < threshold : value > threshold
      const existingAlert = this.alerts.find(alert => alert.deviceId === device.id && alert.metric === metricName && alert.status === 'active')
      if (matches) {
        if (!existingAlert) {
          this.alerts.unshift({ id: this.alertId++, deviceId: device.id, deviceName: device.name, metric: metricName, value, threshold, severity: device.status === 'offline' || value > threshold * 1.5 ? 'critical' : 'warning', message: `${label}: ${device.name}`, status: 'active', createdAt: metric.timestamp })
        }
      } else if (existingAlert) {
        existingAlert.status = 'resolved'
      }
    }
  }
}
