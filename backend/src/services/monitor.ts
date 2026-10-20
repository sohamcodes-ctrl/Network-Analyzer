import type { Alert, Device, Metric, MonitoringDiagnostic } from '../types.js'

export interface MonitorService {
  devices: Device[]
  metrics: Map<number, Metric[]>
  alerts: Alert[]
  diagnostics: MonitoringDiagnostic[]
  check(deviceId: number): Promise<Metric>
  tick(): Promise<unknown>
  runScenario(): Promise<unknown>
  getDevice(id: number): Device
  addDevice(input: Partial<Device>): Device
  hydrate(devices: Device[], metrics: Map<number, Metric[]>, alerts: Alert[]): void
  updateAlert(id: number, status: 'acknowledged' | 'resolved'): Alert
  setLatencyThreshold(threshold: number): void
}
