export type Status = 'online' | 'offline' | 'warning'
export type AlertSeverity = 'info' | 'warning' | 'critical'
export type AlertStatus = 'active' | 'acknowledged' | 'resolved'
export type Metric = { timestamp: string; latencyMs: number; packetLossPercent: number; downloadMbps: number; uploadMbps: number; availabilityPercent: number; errorCount: number; responseTimeMs: number }
export type Device = { id: number; name: string; address: string; type: string; location: string; status: Status; monitoringInterval: number; createdAt: string; lastChecked: string; latest: Metric }
export type Alert = { id: number; deviceId: number; deviceName: string; metric: string; value: number; threshold: number; severity: AlertSeverity; message: string; status: AlertStatus; createdAt: string }
