import assert from 'node:assert/strict'
import test from 'node:test'
import { createDashboard } from './dashboard.js'
import type { MonitorService } from './monitor.js'

test('creates a finite empty dashboard without devices', () => {
  const monitor = { devices: [], metrics: new Map(), alerts: [], diagnostics: [] } as unknown as MonitorService
  const dashboard = createDashboard(monitor, 'simulation', null)
  assert.equal(dashboard.kpis.totalDevices.value, 0)
  assert.equal(dashboard.traffic.length, 0)
  assert.equal(Number.isFinite(dashboard.health.score), true)
})
