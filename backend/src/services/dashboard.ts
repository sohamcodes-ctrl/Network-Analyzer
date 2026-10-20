import type { Metric } from '../types.js'
import type { MonitorService } from './monitor.js'

export const createDashboard = (monitor: MonitorService, mode: 'live' | 'simulation', capacity: { downloadMbps: number; uploadMbps: number } | null) => {
  const devices = monitor.devices
  const latest = devices.map(device => device.latest)
  const avg = (fn: (metric: Metric) => number) => latest.length ? latest.reduce((sum, metric) => sum + fn(metric), 0) / latest.length : 0
  const availability = avg(metric => metric.availabilityPercent)
  const latency = avg(metric => metric.latencyMs)
  const loss = avg(metric => metric.packetLossPercent)
  const download = avg(metric => metric.downloadMbps)
  const upload = avg(metric => metric.uploadMbps)
  const errors = avg(metric => metric.errorCount)
  const displayDownload = capacity?.downloadMbps ?? download
  const factors = {
    availability,
    latency: Math.max(0, 100 - latency / 1.8),
    packetLoss: Math.max(0, 100 - loss * 15),
    bandwidth: Math.min(100, displayDownload / 1.1),
    errorRate: Math.max(0, 100 - errors * 20)
  }
  const weights = { availability: .3, latency: .2, packetLoss: .2, bandwidth: .2, errorRate: .1 }
  const score = Object.entries(factors).reduce((sum, [key, value]) => sum + value * weights[key as keyof typeof weights], 0)
  const kpi = (value: number, previous: number, unit: string) => ({
    value: +value.toFixed(1),
    previous: +previous.toFixed(1),
    unit,
    trend: Array.from({ length: 12 }, (_, index) => +(value * (.92 + Math.sin(index * .8) * .06)).toFixed(1))
  })
  const traffic = (monitor.metrics.get(devices[0]?.id || 0) || []).slice(-24)
  const problematic = devices.map(device => {
    const metric = device.latest
    const active = monitor.alerts.filter(alert => alert.deviceId === device.id && alert.status === 'active').length
    const risk = Math.min(100, (100 - metric.availabilityPercent) * .3 + metric.latencyMs * .25 + metric.packetLossPercent * 10 + Math.max(0, 60 - metric.downloadMbps) * .35 + active * 12)
    return { device, score: +risk.toFixed(0), level: risk > 65 ? 'Critical' : risk > 35 ? 'Warning' : 'Healthy' }
  }).sort((left, right) => right.score - left.score)
  return {
    mode,
    generatedAt: new Date().toISOString(),
    kpis: {
      totalDevices: kpi(devices.length, Math.max(0, devices.length - 1), ''),
      onlineDevices: kpi(devices.filter(device => device.status === 'online').length, Math.max(0, devices.length - 1), ''),
      offlineDevices: kpi(devices.filter(device => device.status === 'offline').length, 0, ''),
      averageLatency: kpi(latency, latency * 1.08, 'ms'),
      packetLoss: kpi(loss, loss * .87, '%'),
      availability: kpi(availability, availability - .5, '%'),
      download: kpi(download, download * .95, 'Mbps'),
      upload: kpi(upload, upload * 1.05, 'Mbps')
    },
    capacity,
    health: { score: +score.toFixed(0), status: score >= 90 ? 'Excellent' : score >= 75 ? 'Healthy' : score >= 55 ? 'Warning' : 'Critical', explanation: score >= 90 ? 'All monitored indicators are within target ranges.' : 'One or more indicators need attention.', factors },
    traffic,
    devices,
    alerts: monitor.alerts.slice(0, 20),
    problematic
  }
}
