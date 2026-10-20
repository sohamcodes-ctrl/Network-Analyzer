import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import { ZodError } from 'zod'
import { SimulationService } from './services/simulation.js'
import { LiveMonitoringService } from './services/live.js'
import { speedTestService } from './services/speedtest.js'
import { settingsService, type AppSettings } from './services/settings.js'
import { validateAuthConfig, clearExpiredLoginAttempts } from './auth.js'
import { createRepository } from './persistence.js'
import { MonitoringScheduler } from './services/scheduler.js'
import { createApiRouter, protectApi, type RouteContext } from './routes/index.js'
import type { MonitorService } from './services/monitor.js'

const app = express()
const port = Number(process.env.PORT || 4000)
const repository = createRepository()
const scheduler = new MonitoringScheduler()
const maxManualChecks = Number(process.env.MAX_MANUAL_CHECKS || 4)
let monitor: MonitorService = process.env.SIMULATION_MODE === 'true' ? new SimulationService() : new LiveMonitoringService()
let ready = false

validateAuthConfig()

const persistState = async () => {
  if (repository.enabled) await repository.saveState(monitor.devices, monitor.alerts)
}

const persistDiagnostic = async (deviceId: number, fallbackError?: unknown) => {
  if (!repository.enabled) return
  const diagnostic = monitor.diagnostics.find(item => item.deviceId === deviceId)
  const error = fallbackError instanceof Error ? fallbackError.message : typeof fallbackError === 'string' ? fallbackError : diagnostic?.message
  await repository.saveLog(deviceId, error ? 'failure' : 'success', diagnostic?.responseTimeMs ?? null, error)
}

const restoreMonitorState = async () => {
  if (!repository.enabled) return
  const devices = await repository.loadDevices()
  if (!devices.length) return
  monitor.hydrate(devices, await repository.loadMetrics(devices.map(device => device.id)), await repository.loadAlerts())
}

const ensureBootstrapUsers = async () => {
  if (!repository.enabled) return
  const adminPassword = process.env.ADMIN_PASSWORD || ''
  const viewerPassword = process.env.VIEWER_PASSWORD || ''
  if (adminPassword) await repository.upsertUser({ id: 'admin', email: process.env.ADMIN_EMAIL || '', name: 'Admin User', role: 'admin', passwordHash: await bcrypt.hash(adminPassword, 10) })
  if (process.env.VIEWER_EMAIL && viewerPassword) await repository.upsertUser({ id: 'viewer', email: process.env.VIEWER_EMAIL, name: 'Viewer', role: 'viewer', passwordHash: await bcrypt.hash(viewerPassword, 10) })
}

const schedulerOptions = () => ({
  onCheckComplete: async (deviceId: number) => { await persistState(); await persistDiagnostic(deviceId) },
  onCheckError: async (deviceId: number, error: unknown) => { console.error(`Scheduled check failed for device ${deviceId}`, error); await persistDiagnostic(deviceId, error) }
})

const switchMode = async (mode: AppSettings['operatingMode']) => {
  scheduler.stop()
  if (monitor instanceof LiveMonitoringService) monitor.stop()
  monitor = mode === 'simulation' ? new SimulationService() : new LiveMonitoringService()
  await restoreMonitorState()
  monitor.setLatencyThreshold(settingsService.getSettings().latencyThresholdMs)
  monitor.devices.forEach(device => { device.monitoringInterval = settingsService.getSettings().checkIntervalSeconds })
  scheduler.start(monitor, schedulerOptions())
}

const context: RouteContext = {
  repository,
  getMonitor: () => monitor,
  getMode: () => monitor instanceof SimulationService ? 'simulation' : 'live',
  getSettings: () => settingsService.getSettings(),
  saveSettings: async settings => {
    await settingsService.saveSettings(settings)
    if (repository.enabled) await repository.saveSettings(settingsService.getSettings())
  },
  switchMode,
  persistState,
  persistDiagnostic,
  refreshScheduler: () => scheduler.refresh(),
  maxManualChecks
}

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }))
app.use(express.json())
app.use((req, res, next) => {
  res.setHeader('x-request-id', req.header('x-request-id') || randomUUID())
  next()
})
app.get('/health', (_req, res) => res.json({ status: 'ok' }))
app.get('/ready', (_req, res) => ready ? res.json({ status: 'ready', persistence: repository.enabled ? 'enabled' : 'memory' }) : res.status(503).json({ status: 'not_ready' }))
app.use('/api', protectApi())
app.use('/api', createApiRouter(context))
setInterval(clearExpiredLoginAttempts, 15 * 60 * 1000).unref()

const start = async () => {
  await repository.initialize()
  await ensureBootstrapUsers()
  await settingsService.loadSettings()
  const environmentMode = process.env.SIMULATION_MODE === 'true' ? 'simulation' : process.env.SIMULATION_MODE === 'false' ? 'live' : null
  if (environmentMode && settingsService.getSettings().operatingMode !== environmentMode) {
    await settingsService.saveSettings({ operatingMode: environmentMode })
  }
  if (repository.enabled) {
    const storedSettings = await repository.loadSettings()
    if (storedSettings) await settingsService.saveSettings(storedSettings)
    else await repository.saveSettings(settingsService.getSettings())
  }
  await switchMode(settingsService.getSettings().operatingMode)
  ready = true
  const server = app.listen(port, () => console.log(`Monitoring API listening on http://localhost:${port}`))
  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}; shutting down monitoring API`)
    ready = false
    scheduler.stop()
    if (monitor instanceof LiveMonitoringService) monitor.stop()
    speedTestService.stop()
    await repository.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
  process.once('SIGINT', () => { void shutdown('SIGINT') })
  process.once('SIGTERM', () => { void shutdown('SIGTERM') })
}

app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) {
    const message = error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(', ')
    res.status(400).json({ message: message || 'Validation failed', issues: error.issues })
    return
  }
  const typed = error as { status?: number; message?: string; issues?: unknown }
  const status = typed.status || 500
  console.error(JSON.stringify({ requestId: res.getHeader('x-request-id'), method: req.method, path: req.path, status, message: typed.message || 'Unhandled error' }))
  res.status(status).json({ message: status === 500 ? 'Internal server error' : typed.message || 'Invalid request', issues: status === 500 ? undefined : typed.issues })
})

start().catch(error => { console.error('Unable to start monitoring API', error); process.exitCode = 1 })
