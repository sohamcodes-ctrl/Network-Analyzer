import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { authenticate, issueToken, loginRateLimit, requireRole } from '../auth.js'
import { loginSchema } from '../schemas/auth.js'
import { deviceIdSchema, deviceSchema } from '../schemas/devices.js'
import { analyticsMetricSchema, anomalyMethodSchema } from '../schemas/analytics.js'
import { reportPeriodSchema } from '../schemas/reports.js'
import { settingsSchema } from '../schemas/settings.js'
import type { MonitorRepository } from '../persistence.js'
import type { AppSettings } from '../services/settings.js'
import type { MonitorService } from '../services/monitor.js'
import { pearson, statistics } from '../services/statistics.js'
import { createDashboard } from '../services/dashboard.js'
import { speedTestService } from '../services/speedtest.js'

export type RouteContext = {
  repository: MonitorRepository
  getMonitor: () => MonitorService
  getMode: () => 'live' | 'simulation'
  getSettings: () => AppSettings
  saveSettings: (settings: AppSettings) => Promise<void>
  switchMode: (mode: AppSettings['operatingMode']) => Promise<void>
  persistState: () => Promise<void>
  persistDiagnostic: (deviceId: number, error?: unknown) => Promise<void>
  refreshScheduler: () => void
  maxManualChecks: number
}

export const createApiRouter = (context: RouteContext) => {
  const router = Router()
  const activeManualChecks = new Set<number>()
  const getDashboard = () => createDashboard(context.getMonitor(), context.getMode(), context.getMode() === 'live' ? speedTestService.getLatestResult() : null)

  router.post('/auth/login', loginRateLimit, async (req, res, next) => {
    try {
      const body = loginSchema.parse(req.body)
      const { repository } = context
      const adminEmail = process.env.ADMIN_EMAIL || ''
      const adminPassword = process.env.ADMIN_PASSWORD || ''
      const viewerEmail = process.env.VIEWER_EMAIL || ''
      const viewerPassword = process.env.VIEWER_PASSWORD || ''
      const storedUser = await repository.findUserByEmail(body.email)
      const adminHash = adminPassword ? await bcrypt.hash(adminPassword, 10) : ''
      const viewerHash = viewerPassword ? await bcrypt.hash(viewerPassword, 10) : ''
      const isStoredUser = Boolean(storedUser && await bcrypt.compare(body.password, storedUser.passwordHash))
      const isAdmin = body.email.toLowerCase() === adminEmail.toLowerCase() && Boolean(adminHash) && await bcrypt.compare(body.password, adminHash)
      const isViewer = body.email.toLowerCase() === viewerEmail.toLowerCase() && Boolean(viewerHash) && await bcrypt.compare(body.password, viewerHash)
      if (!isStoredUser && !isAdmin && !isViewer) return res.status(401).json({ message: 'Invalid credentials' })
      const user = storedUser && isStoredUser ? { id: storedUser.id, email: storedUser.email, name: storedUser.name, role: storedUser.role }
        : isAdmin ? { id: 'admin', email: adminEmail, name: 'Admin User', role: 'admin' as const }
        : { id: 'viewer', email: viewerEmail, name: 'Viewer', role: 'viewer' as const }
      res.json({ token: issueToken(user), user })
    } catch (error) { next(error) }
  })
  router.post('/auth/logout', (_req, res) => res.status(204).end())
  router.get('/dashboard', async (_req, res, next) => {
    try {
      const monitor = context.getMonitor()
      if ('refreshTraffic' in monitor && typeof monitor.refreshTraffic === 'function') {
        await monitor.refreshTraffic()
        await context.persistState()
      }
      res.json(getDashboard())
    } catch (error) { next(error) }
  })
  router.get('/devices', (_req, res) => res.json(context.getMonitor().devices))
  router.post('/devices', requireRole('admin'), async (req, res, next) => {
    try {
      const device = context.getMonitor().addDevice(deviceSchema.parse(req.body))
      await context.persistState()
      context.refreshScheduler()
      res.status(201).json(device)
    } catch (error) { next(error) }
  })
  router.get('/devices/:id', (req, res, next) => {
    try { res.json(context.getMonitor().getDevice(deviceIdSchema.parse(req.params.id))) } catch (error) { next(error) }
  })
  router.get('/monitoring/:deviceId', (req, res, next) => {
    try {
      const id = deviceIdSchema.parse(req.params.deviceId)
      context.getMonitor().getDevice(id)
      res.json(context.getMonitor().metrics.get(id) || [])
    } catch (error) { next(error) }
  })
  router.get('/monitoring/:deviceId/latest', (req, res, next) => {
    try { res.json(context.getMonitor().getDevice(deviceIdSchema.parse(req.params.deviceId)).latest) } catch (error) { next(error) }
  })
  router.post('/monitoring/check/:deviceId', async (req, res, next) => {
    try {
      const id = deviceIdSchema.parse(req.params.deviceId)
      const monitor = context.getMonitor()
      monitor.getDevice(id)
      if (activeManualChecks.size >= context.maxManualChecks || activeManualChecks.has(id)) {
        res.status(429).json({ message: 'A monitoring check is already in progress or capacity is full.' })
        return
      }
      activeManualChecks.add(id)
      try {
        const metric = await monitor.check(id)
        await context.persistState()
        await context.persistDiagnostic(id)
        res.json(metric)
      } finally { activeManualChecks.delete(id) }
    } catch (error) { next(error) }
  })
  router.get('/hotspot/clients', async (_req, res, next) => {
    try {
      const monitor = context.getMonitor()
      if (!('getHotspotSnapshot' in monitor) || typeof monitor.getHotspotSnapshot !== 'function') {
        res.json({ enabled: false, captureActive: false, message: 'Hotspot client traffic is available only in Live Mode.', clients: [] })
        return
      }
      res.json(await monitor.getHotspotSnapshot())
    } catch (error) { next(error) }
  })
  router.get('/analytics/:deviceId/statistics', (req, res, next) => {
    try {
      const records = context.getMonitor().metrics.get(deviceIdSchema.parse(req.params.deviceId))
      if (!records) throw Object.assign(new Error('Device not found'), { status: 404 })
      const metric = analyticsMetricSchema.parse(String(req.query.metric || 'latencyMs'))
      const method = anomalyMethodSchema.parse(String(req.query.method || 'zscore'))
      res.json({ ...statistics(records, metric, method), correlation: pearson(records) })
    } catch (error) { next(error) }
  })
  router.get('/analytics/:deviceId/anomalies', (req, res, next) => {
    try {
      const records = context.getMonitor().metrics.get(deviceIdSchema.parse(req.params.deviceId))
      if (!records) throw Object.assign(new Error('Device not found'), { status: 404 })
      res.json(statistics(records, 'latencyMs', anomalyMethodSchema.parse(String(req.query.method || 'zscore'))).anomalies)
    } catch (error) { next(error) }
  })
  router.get('/alerts', (_req, res) => res.json(context.getMonitor().alerts))
  router.get('/diagnostics', (_req, res) => res.json(context.getMonitor().diagnostics.slice(0, 100)))
  router.put('/alerts/:id/:action', requireRole('admin'), async (req, res, next) => {
    try {
      const action = z.enum(['acknowledge', 'resolve']).parse(req.params.action)
      const alert = context.getMonitor().updateAlert(deviceIdSchema.parse(req.params.id), action === 'acknowledge' ? 'acknowledged' : 'resolved')
      await context.repository.saveAlert(alert)
      res.json(alert)
    } catch (error) { next(error) }
  })
  router.post('/simulation/run', requireRole('admin'), async (_req, res, next) => {
    try {
      await context.getMonitor().runScenario()
      await context.persistState()
      res.json(getDashboard())
    } catch (error) { next(error) }
  })
  router.get('/reports/:period', (req, res, next) => {
    try {
      const period = reportPeriodSchema.parse(req.params.period)
      const data = getDashboard()
      res.json({ report: { title: `${period === 'weekly' ? 'Weekly' : 'Daily'} network report`, generatedAt: data.generatedAt, networkAvailability: `${data.kpis.availability.value}%`, averageLatency: `${data.kpis.averageLatency.value} ms`, packetLoss: `${data.kpis.packetLoss.value}%`, averageDownload: `${data.kpis.download.value} Mbps`, activeAlerts: data.alerts.filter(alert => alert.status === 'active').length, topProblematicDevices: data.problematic.slice(0, 3).map(item => `${item.device.name} (${item.score})`).join(', ') } })
    } catch (error) { next(error) }
  })
  router.get('/settings', (_req, res) => res.json(context.getSettings()))
  router.put('/settings', requireRole('admin'), async (req, res, next) => {
    try {
      const settings = settingsSchema.parse(req.body)
      const previous = context.getSettings()
      await context.saveSettings(settings)
      if (previous.operatingMode !== settings.operatingMode) await context.switchMode(settings.operatingMode)
      const monitor = context.getMonitor()
      monitor.setLatencyThreshold(settings.latencyThresholdMs)
      monitor.devices.forEach(device => { device.monitoringInterval = settings.checkIntervalSeconds })
      context.refreshScheduler()
      res.json(context.getSettings())
    } catch (error) { next(error) }
  })
  return router
}

export const protectApi = () => {
  const middleware = Router()
  middleware.use((req, res, next) => req.path === '/auth/login' ? next() : authenticate(req, res, next))
  return middleware
}
