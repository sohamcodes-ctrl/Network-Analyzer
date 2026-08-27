import { spawn } from 'node:child_process'

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

export interface HotspotClient {
  ip: string
  mac: string
  interface: string
}

export class HotspotDetectionService {
  async getConnectedClients(): Promise<HotspotClient[]> {
    try {
      // Query ARP table for Reachable neighbors. 
      // Mobile Hotspot interfaces usually have names like 'Local Area Connection* 2' 
      // but we will look at all non-loopback reachable IPv4 neighbors.
      const command = "Get-NetNeighbor -AddressFamily IPv4 | Where-Object State -eq 'Reachable' | Select-Object IPAddress, LinkLayerAddress, InterfaceAlias | ConvertTo-Json -Compress"
      const raw = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], 5000)
      
      if (!raw.trim()) return []
      
      const parsed = JSON.parse(raw)
      const records = Array.isArray(parsed) ? parsed : [parsed]
      
      return records
        .filter(r => r && r.IPAddress && !r.IPAddress.startsWith('224.') && !r.IPAddress.startsWith('239.') && r.IPAddress !== '255.255.255.255')
        .map(r => ({
          ip: r.IPAddress,
          mac: r.LinkLayerAddress,
          interface: r.InterfaceAlias
        }))
    } catch (e) {
      console.error('Failed to detect hotspot clients:', e)
      return []
    }
  }
}
