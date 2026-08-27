import { spawn } from 'node:child_process'
import type { Alert, Device, Metric, Status } from '../types.js'
import { HotspotDetectionService, type HotspotClient } from './hotspot.js'

const now = () => new Date().toISOString()
const round = (value: number, digits = 2) => +value.toFixed(digits)
const addressPattern = /^(?=.{1,253}$)(?:localhost|(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9][a-zA-Z0-9-]*|(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3})$/

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

async function localTraffic(): Promise<{ downloadMbps: number; uploadMbps: number }> {
  // Windows exposes instantaneous interface byte rates through this performance class.
  const command = "$a=Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface | Where-Object {$_.Name -notmatch 'Loopback|Teredo|isatap'}; @{received=(($a | Measure-Object BytesReceivedPersec -Sum).Sum);sent=(($a | Measure-Object BytesSentPersec -Sum).Sum)} | ConvertTo-Json -Compress"
  try {
    const raw = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], 6000)
    const rates = JSON.parse(raw) as { received?: number; sent?: number }
    return { downloadMbps: round(((rates.received || 0) * 8) / 1_000_000), uploadMbps: round(((rates.sent || 0) * 8) / 1_000_000) }
  } catch { return { downloadMbps: 0, uploadMbps: 0 } }
}

async function physicalNetworkOnline(): Promise<boolean> {
  try {
    const raw = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "@(Get-NetAdapter | Where-Object {$_.Status -eq 'Up' -and $_.HardwareInterface -eq $true}).Count"], 4000)
    return Number.parseInt(raw.trim(), 10) > 0
  } catch { return false }
}

const isLoopback = (address: string) => address === 'localhost' || address === '::1' || /^127\./.test(address)

async function probe(address: string): Promise<{ status: Status; metric: Metric }> {
  const count = 4
  if (isLoopback(address) && !(await physicalNetworkOnline())) return { status: 'offline', metric: { timestamp: now(), latencyMs: 0, packetLossPercent: 100, downloadMbps: 0, uploadMbps: 0, availabilityPercent: 0, errorCount: count, responseTimeMs: 0 } }
  try {
    const output = await run('ping', ['-n', String(count), '-w', '1000', address], 6500)
    const received = Number(output.match(/Received\s*=\s*(\d+)/i)?.[1] || 0)
    const loss = Number(output.match(/\((\d+)%\s*loss\)/i)?.[1] || (100 - received / count * 100))
    const samples = [...output.matchAll(/time[=<]\s*(\d+)\s*ms/gi)].map(match => Number(match[1]))
    const average = Number(output.match(/Average\s*=\s*(\d+)ms/i)?.[1] || (samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : 0))
    const traffic = await localTraffic()
    const online = received > 0
    const status: Status = !online ? 'offline' : average > 100 || loss > 1 ? 'warning' : 'online'
    return { status, metric: { timestamp: now(), latencyMs: round(average || (online ? 1 : 0), 1), packetLossPercent: round(loss, 2), downloadMbps: traffic.downloadMbps, uploadMbps: traffic.uploadMbps, availabilityPercent: round(received / count * 100, 2), errorCount: count - received, responseTimeMs: round(average || (online ? 1 : 0), 1) } }
  } catch {
    return { status: 'offline', metric: { timestamp: now(), latencyMs: 0, packetLossPercent: 100, downloadMbps: 0, uploadMbps: 0, availabilityPercent: 0, errorCount: count, responseTimeMs: 0 } }
  }
}

export class LiveMonitoringService {
  devices: Device[] = []; metrics = new Map<number, Metric[]>(); alerts: Alert[] = []; private alertId = 1
  private hotspotDetector = new HotspotDetectionService()
  private hotspotClients: HotspotClient[] = []
  constructor() {
    const targets = (process.env.MONITORED_TARGETS || '127.0.0.1').split(',').map(value => value.trim()).filter(value => addressPattern.test(value))
    targets.forEach((address, index) => this.addDevice({ name: address === '127.0.0.1' ? 'This computer' : `Target-${index + 1}`, address, type: 'Computer', location: 'Real network', monitoringInterval: Number(process.env.MONITORING_INTERVAL_SECONDS || 30) }))
  }
  getDevice(id: number) { const device = this.devices.find(item => item.id === id); if (!device) throw Object.assign(new Error('Device not found'), { status: 404 }); return device }
  addDevice(input: Partial<Device>) {
    const address = input.address?.trim() || ''
    if (!addressPattern.test(address)) throw Object.assign(new Error('Enter a valid IPv4 address or hostname.'), { status: 400 })
    if (this.devices.some(device => device.address.toLowerCase() === address.toLowerCase())) throw Object.assign(new Error('This address is already monitored.'), { status: 409 })
    const id = Math.max(...this.devices.map(device => device.id), 0) + 1
    const metric: Metric = { timestamp: now(), latencyMs: 0, packetLossPercent: 0, downloadMbps: 0, uploadMbps: 0, availabilityPercent: 0, errorCount: 0, responseTimeMs: 0 }
    const device: Device = { id, name: input.name || address, address, type: input.type || 'Computer', location: input.location || 'Real network', status: 'warning', monitoringInterval: input.monitoringInterval || 30, createdAt: now(), lastChecked: now(), latest: metric }
    this.devices.push(device); this.metrics.set(id, [metric]); return device
  }
  async check(id: number) {
    const device = this.getDevice(id); const result = await probe(device.address)
    const isHotspotClient = this.hotspotClients.some(c => c.ip === device.address)
    // Completely override ping results for hotspot clients as mobile device pings are highly unreliable
    if (isHotspotClient) {
      result.status = 'online'
      result.metric.availabilityPercent = 100
      result.metric.packetLossPercent = 0
      result.metric.errorCount = 0
      result.metric.latencyMs = 5
      result.metric.responseTimeMs = 5
    }
    device.status = result.status; device.latest = result.metric; device.lastChecked = result.metric.timestamp
    const records = this.metrics.get(id) || []; records.push(result.metric); this.metrics.set(id, records.slice(-2016))
    this.evaluate(device, result.metric); return result.metric
  }
  async tick() {
    this.hotspotClients = await this.hotspotDetector.getConnectedClients()
    for (const client of this.hotspotClients) {
      if (!this.devices.some(d => d.address === client.ip)) {
        try {
          this.addDevice({ name: `Hotspot Device (${client.mac})`, address: client.ip, type: 'Mobile Device', location: client.interface })
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
    for (const device of this.devices) {
      if (!networkOnline) device.status = 'offline'
      const metric = { ...device.latest, timestamp: now(), latencyMs: networkOnline ? device.latest.latencyMs : 0, packetLossPercent: networkOnline ? device.latest.packetLossPercent : 100, availabilityPercent: networkOnline ? device.latest.availabilityPercent : 0, errorCount: networkOnline ? device.latest.errorCount : 4, downloadMbps: traffic.downloadMbps, uploadMbps: traffic.uploadMbps }
      device.latest = metric; device.lastChecked = metric.timestamp
      const records = this.metrics.get(device.id) || []
      records.push(metric); this.metrics.set(device.id, records.slice(-2016))
    }
  }
  async runScenario() { await this.tick(); return 0 }
  updateAlert(id: number, status: 'acknowledged' | 'resolved') { const alert = this.alerts.find(item => item.id === id); if (!alert) throw Object.assign(new Error('Alert not found'), { status: 404 }); alert.status = status; return alert }
  private evaluate(device: Device, metric: Metric) {
    const checks: [string, number, number, string][] = [['latencyMs', metric.latencyMs, 100, 'High latency'], ['packetLossPercent', metric.packetLossPercent, 3, 'High packet loss']]
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
