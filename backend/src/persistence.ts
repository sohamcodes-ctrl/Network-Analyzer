import mysql, { type Pool, type RowDataPacket } from 'mysql2/promise'
import type { AuthUser } from './auth.js'
import type { Alert, Device, Metric } from './types.js'

export type StoredUser = AuthUser & { passwordHash: string }

type DeviceRow = RowDataPacket & {
  id: number
  name: string
  address: string | null
  type: string
  location: string | null
  status: Device['status']
  monitoring_interval: number
  created_at: Date
}

type MetricRow = RowDataPacket & {
  device_id: number
  timestamp: Date
  latency_ms: number | null
  packet_loss_percent: number | null
  download_mbps: number | null
  upload_mbps: number | null
  availability_percent: number | null
  error_count: number
  response_time_ms: number | null
}

type AlertRow = RowDataPacket & {
  id: number
  device_id: number
  device_name: string
  metric: string
  value: number
  threshold: number | null
  severity: Alert['severity']
  message: string
  status: Alert['status']
  created_at: Date
}

type UserRow = RowDataPacket & {
  id: number
  name: string
  email: string
  password: string
  role: AuthUser['role']
}

export interface MonitorRepository {
  readonly enabled: boolean
  initialize(): Promise<void>
  close(): Promise<void>
  loadDevices(): Promise<Device[]>
  loadMetrics(deviceIds: number[]): Promise<Map<number, Metric[]>>
  loadAlerts(): Promise<Alert[]>
  saveDevice(device: Device): Promise<void>
  saveMetric(deviceId: number, metric: Metric): Promise<void>
  saveAlert(alert: Alert): Promise<void>
  saveLog(deviceId: number, result: 'success' | 'failure', responseTime: number | null, errorMessage?: string): Promise<void>
  findUserByEmail(email: string): Promise<StoredUser | null>
  upsertUser(user: StoredUser): Promise<void>
}

class NoopRepository implements MonitorRepository {
  readonly enabled = false
  async initialize() {}
  async close() {}
  async loadDevices() { return [] }
  async loadMetrics(_deviceIds: number[]) { return new Map<number, Metric[]>() }
  async loadAlerts() { return [] }
  async saveDevice(_device: Device) {}
  async saveMetric(_deviceId: number, _metric: Metric) {}
  async saveAlert(_alert: Alert) {}
  async saveLog(_deviceId: number, _result: 'success' | 'failure', _responseTime: number | null, _errorMessage?: string) {}
  async findUserByEmail(_email: string) { return null }
  async upsertUser(_user: StoredUser) {}
}

class MySqlRepository implements MonitorRepository {
  readonly enabled = true
  private readonly pool: Pool

  constructor() {
    this.pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'network_user',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'smart_network_monitoring',
      waitForConnections: true,
      connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
      queueLimit: 0,
      enableKeepAlive: true,
      connectTimeout: 5000
    })
  }

  async initialize() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(32) PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        setting_key VARCHAR(100) PRIMARY KEY,
        setting_value JSON NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `)
    await this.pool.query("INSERT IGNORE INTO schema_migrations(version) VALUES ('002-app-settings')")
    await this.pool.query('SELECT 1')
  }

  async close() { await this.pool.end() }

  async loadDevices() {
    const [rows] = await this.pool.query<DeviceRow[]>(
      'SELECT id, name, COALESCE(ip_address, hostname) AS address, type, location, status, monitoring_interval, created_at FROM devices ORDER BY id'
    )
    return rows.map(row => {
      const timestamp = new Date(row.created_at).toISOString()
      return {
        id: Number(row.id), name: row.name, address: row.address || '', type: row.type, location: row.location || '', status: row.status,
        monitoringInterval: Number(row.monitoring_interval), createdAt: timestamp, lastChecked: timestamp, latest: emptyMetric(timestamp)
      }
    })
  }

  async loadMetrics(deviceIds: number[]) {
    const metrics = new Map<number, Metric[]>()
    if (!deviceIds.length) return metrics
    const placeholders = deviceIds.map(() => '?').join(',')
    const [rows] = await this.pool.query<MetricRow[]>(
      `SELECT device_id, timestamp, latency_ms, packet_loss_percent, download_mbps, upload_mbps, availability_percent, error_count, response_time_ms
       FROM network_metrics WHERE device_id IN (${placeholders}) ORDER BY timestamp DESC LIMIT 10000`, deviceIds
    )
    for (const row of [...rows].reverse()) {
      const list = metrics.get(Number(row.device_id)) || []
      list.push(mapMetric(row))
      metrics.set(Number(row.device_id), list.slice(-2016))
    }
    return metrics
  }

  async loadAlerts() {
    const [rows] = await this.pool.query<AlertRow[]>(
      `SELECT a.id, a.device_id, d.name AS device_name, a.metric, a.value, a.threshold, a.severity, a.message, a.status, a.created_at
       FROM alerts a JOIN devices d ON d.id = a.device_id ORDER BY a.created_at DESC LIMIT 500`
    )
    return rows.map(row => ({
      id: Number(row.id), deviceId: Number(row.device_id), deviceName: row.device_name, metric: row.metric,
      value: Number(row.value), threshold: row.threshold === null ? 0 : Number(row.threshold), severity: row.severity,
      message: row.message, status: row.status, createdAt: new Date(row.created_at).toISOString()
    }))
  }

  async saveDevice(device: Device) {
    await this.pool.execute(
      `INSERT INTO devices(id, name, ip_address, hostname, type, location, monitoring_interval, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), ip_address=VALUES(ip_address), hostname=VALUES(hostname), type=VALUES(type), location=VALUES(location), monitoring_interval=VALUES(monitoring_interval), status=VALUES(status)`,
      [device.id, device.name, device.address || null, device.address || null, device.type, device.location, device.monitoringInterval, device.status]
    )
  }

  async saveMetric(deviceId: number, metric: Metric) {
    await this.pool.execute(
      `INSERT INTO network_metrics(device_id, timestamp, latency_ms, packet_loss_percent, download_mbps, upload_mbps, availability_percent, error_count, response_time_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [deviceId, new Date(metric.timestamp), metric.latencyMs, metric.packetLossPercent, metric.downloadMbps, metric.uploadMbps, metric.availabilityPercent, metric.errorCount, metric.responseTimeMs]
    )
  }

  async saveAlert(alert: Alert) {
    await this.pool.execute(
      `INSERT INTO alerts(id, device_id, metric, value, threshold, severity, message, status, created_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE value=VALUES(value), threshold=VALUES(threshold), severity=VALUES(severity), message=VALUES(message), status=VALUES(status), resolved_at=IF(VALUES(status) = 'resolved', COALESCE(resolved_at, CURRENT_TIMESTAMP), NULL)`,
      [alert.id, alert.deviceId, alert.metric, alert.value, alert.threshold, alert.severity, alert.message, alert.status, new Date(alert.createdAt), null]
    )
  }

  async saveLog(deviceId: number, result: 'success' | 'failure', responseTime: number | null, errorMessage?: string) {
    await this.pool.execute(
      'INSERT INTO monitoring_logs(device_id, timestamp, check_type, result, response_time, error_message) VALUES (?, ?, ?, ?, ?, ?)',
      [deviceId, new Date(), 'probe', result, responseTime, errorMessage || null]
    )
  }

  async findUserByEmail(email: string) {
    const [rows] = await this.pool.query<UserRow[]>('SELECT id, name, email, password, role FROM users WHERE email = ? LIMIT 1', [email.toLowerCase()])
    const row = rows[0]
    return row ? { id: String(row.id), name: row.name, email: row.email, role: row.role, passwordHash: row.password } : null
  }

  async upsertUser(user: StoredUser) {
    await this.pool.execute(
      `INSERT INTO users(name, email, password, role) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), password=VALUES(password), role=VALUES(role)`,
      [user.name, user.email.toLowerCase(), user.passwordHash, user.role]
    )
  }
}

const emptyMetric = (timestamp: string): Metric => ({ timestamp, latencyMs: 0, packetLossPercent: 100, downloadMbps: 0, uploadMbps: 0, availabilityPercent: 0, errorCount: 0, responseTimeMs: 0 })

const mapMetric = (row: MetricRow): Metric => ({
  timestamp: new Date(row.timestamp).toISOString(), latencyMs: Number(row.latency_ms || 0), packetLossPercent: Number(row.packet_loss_percent || 0),
  downloadMbps: Number(row.download_mbps || 0), uploadMbps: Number(row.upload_mbps || 0), availabilityPercent: Number(row.availability_percent || 0),
  errorCount: Number(row.error_count || 0), responseTimeMs: Number(row.response_time_ms || 0)
})

export const createRepository = (): MonitorRepository => process.env.DB_ENABLED === 'true' ? new MySqlRepository() : new NoopRepository()
