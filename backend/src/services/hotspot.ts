import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

type HotspotInterface = { ip: string; interfaceAlias: string; interfaceGuid: string; interfaceIndex: number }
type ClientCounter = { ip: string; mac: string; interface: string; uploadBytes: number; downloadBytes: number; sampledUploadBytes: number; sampledDownloadBytes: number; uploadMbps: number; downloadMbps: number; lastSeen: number; lastSample: number }

export type HotspotClient = { ip: string; mac: string; interface: string; uploadMbps: number; downloadMbps: number; totalUploadBytes: number; totalDownloadBytes: number; lastSeen: string }
export type HotspotSnapshot = { enabled: boolean; captureActive: boolean; message: string; interface?: string; clients: HotspotClient[] }

const tsharkPath = () => process.env.TSHARK_PATH || 'C:\\Program Files\\Wireshark\\tshark.exe'
const subnet = process.env.HOTSPOT_SUBNET || '192.168.137.0/24'
const subnetPrefix = subnet.replace(/\.0\/24$/, '.')

function command(commandName: string, args: string[], timeout = 20000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(commandName, args, { windowsHide: true, shell: false })
    let stdout = ''; let stderr = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${commandName} timed out`)) }, timeout)
    child.stdout.on('data', chunk => { stdout += chunk.toString() })
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject(new Error(stderr || `${commandName} exited with code ${code}`)) })
  })
}

const isClientIp = (ip: string, gateway: string) => ip.startsWith(subnetPrefix) && ip !== gateway && !ip.endsWith('.255')

export class HotspotTrafficService {
  private capture: ChildProcessWithoutNullStreams | null = null
  private hotspot: HotspotInterface | null = null
  private clients = new Map<string, ClientCounter>()
  private lastError = ''

  async snapshot(): Promise<HotspotSnapshot> {
    let hotspot: HotspotInterface | null = null
    try {
      hotspot = await this.findHotspotInterface()
    } catch (e) {
      this.stopCapture()
      return { enabled: false, captureActive: false, message: `Error finding hotspot: ${e instanceof Error ? e.message : String(e)}`, clients: [] }
    }

    if (!hotspot) {
      this.stopCapture()
      return { enabled: false, captureActive: false, message: `No active Windows Mobile Hotspot adapter found on ${subnet}.`, clients: [] }
    }
    this.hotspot = hotspot
    await this.mergeNeighbors(hotspot)
    this.ensureCapture(hotspot)
    this.refreshRates()
    const clients = [...this.clients.values()]
      .filter(client => Date.now() - client.lastSeen < 30_000)
      .map(client => ({ ip: client.ip, mac: client.mac, interface: client.interface, uploadMbps: client.uploadMbps, downloadMbps: client.downloadMbps, totalUploadBytes: client.uploadBytes, totalDownloadBytes: client.downloadBytes, lastSeen: new Date(client.lastSeen).toISOString() }))
      .sort((a, b) => b.downloadMbps + b.uploadMbps - (a.downloadMbps + a.uploadMbps))
    return { enabled: true, captureActive: this.capture !== null, message: this.lastError || (this.capture ? 'Capturing packet traffic for connected hotspot clients.' : 'Capture is not running.'), interface: hotspot.interfaceAlias, clients }
  }

  stopCapture() {
    if (this.capture) { this.capture.kill(); this.capture = null }
    this.hotspot = null
  }

  private async findHotspotInterface(): Promise<HotspotInterface | null> {
    const script = `$ip=Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -like '${subnetPrefix}*'} | Select-Object -First 1; if($ip){$adapter=Get-NetAdapter -InterfaceIndex $ip.InterfaceIndex; @{ip=$ip.IPAddress;interfaceAlias=$adapter.Name;interfaceGuid=$adapter.InterfaceGuid;interfaceIndex=$ip.InterfaceIndex}|ConvertTo-Json -Compress}`
    try {
      const raw = await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
      if (!raw.trim()) return null
      return JSON.parse(raw) as HotspotInterface
    } catch (e) {
      throw new Error(`powershell error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  private async mergeNeighbors(hotspot: HotspotInterface) {
    const script = `Get-NetNeighbor -AddressFamily IPv4 -InterfaceIndex ${hotspot.interfaceIndex} | Where-Object {$_.State -in 'Reachable','Stale','Delay','Probe','Permanent'} | Select-Object IPAddress,LinkLayerAddress | ConvertTo-Json -Compress`
    try {
      const raw = await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
      if (!raw.trim()) return
      const parsed = JSON.parse(raw) as unknown
      const neighbors = (Array.isArray(parsed) ? parsed : [parsed]) as Array<{ IPAddress: string; LinkLayerAddress: string }>
      for (const neighbor of neighbors) if (neighbor?.IPAddress && isClientIp(neighbor.IPAddress, hotspot.ip)) this.ensureClient(neighbor.IPAddress, neighbor.LinkLayerAddress || 'Unknown', hotspot.interfaceAlias)
    } catch { /* Packet capture can still discover clients when the neighbor cache is empty. */ }
  }

  private ensureCapture(hotspot: HotspotInterface) {
    const device = `\\\\Device\\NPF_${hotspot.interfaceGuid}`
    if (this.capture && this.capture.spawnargs.includes(device)) return
    this.stopCapture()
    try {
      const child = spawn(tsharkPath(), ['-l', '-n', '-i', device, '-f', `ip and net ${subnet}`, '-T', 'fields', '-E', 'separator=\t', '-E', 'occurrence=f', '-e', 'ip.src', '-e', 'ip.dst', '-e', 'frame.len'], { windowsHide: true, shell: false })
      this.capture = child
      this.lastError = ''
      let pending = ''
      child.stdout.on('data', chunk => { pending += chunk.toString(); const lines = pending.split(/\r?\n/); pending = lines.pop() || ''; lines.forEach(line => this.recordPacket(line, hotspot)) })
      child.stderr.on('data', chunk => { const text = chunk.toString().trim(); if (text) this.lastError = text })
      child.on('error', error => { this.lastError = `Unable to start tshark: ${error.message}`; this.capture = null })
      child.on('close', code => { if (this.capture === child) this.capture = null; if (code && !this.lastError) this.lastError = `tshark stopped (exit ${code}).` })
    } catch (error) { this.lastError = error instanceof Error ? error.message : 'Unable to start tshark.' }
  }

  private recordPacket(line: string, hotspot: HotspotInterface) {
    const [source, destination, lengthText] = line.split('\t')
    const bytes = Number(lengthText)
    if (!Number.isFinite(bytes) || bytes <= 0) return
    if (isClientIp(source, hotspot.ip)) { const client = this.ensureClient(source, 'Unknown', hotspot.interfaceAlias); client.uploadBytes += bytes; client.lastSeen = Date.now() }
    if (isClientIp(destination, hotspot.ip)) { const client = this.ensureClient(destination, 'Unknown', hotspot.interfaceAlias); client.downloadBytes += bytes; client.lastSeen = Date.now() }
  }

  private ensureClient(ip: string, mac: string, networkInterface: string) {
    const existing = this.clients.get(ip)
    if (existing) { if (mac !== 'Unknown') existing.mac = mac; return existing }
    const created: ClientCounter = { ip, mac, interface: networkInterface, uploadBytes: 0, downloadBytes: 0, sampledUploadBytes: 0, sampledDownloadBytes: 0, uploadMbps: 0, downloadMbps: 0, lastSeen: Date.now(), lastSample: Date.now() }
    this.clients.set(ip, created); return created
  }

  private refreshRates() {
    const now = Date.now()
    for (const client of this.clients.values()) {
      const elapsedSeconds = Math.max((now - client.lastSample) / 1000, .25)
      client.uploadMbps = +(((client.uploadBytes - client.sampledUploadBytes) * 8 / 1_000_000) / elapsedSeconds).toFixed(2)
      client.downloadMbps = +(((client.downloadBytes - client.sampledDownloadBytes) * 8 / 1_000_000) / elapsedSeconds).toFixed(2)
      client.sampledUploadBytes = client.uploadBytes; client.sampledDownloadBytes = client.downloadBytes; client.lastSample = now
    }
  }
}
