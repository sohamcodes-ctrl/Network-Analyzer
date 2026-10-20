import assert from 'node:assert/strict'
import test from 'node:test'
import { deviceIdSchema } from './schemas/devices.js'
import { reportPeriodSchema } from './schemas/reports.js'
import { settingsSchema } from './schemas/settings.js'

test('rejects invalid route identifiers and report periods', () => {
  assert.throws(() => deviceIdSchema.parse('0'))
  assert.throws(() => deviceIdSchema.parse('not-an-id'))
  assert.throws(() => reportPeriodSchema.parse('monthly'))
})

test('validates complete runtime settings', () => {
  const settings = settingsSchema.parse({
    checkIntervalSeconds: 30,
    dashboardRefreshMode: 'Every 10 seconds',
    latencyThresholdMs: 100,
    displayName: 'Admin',
    email: 'admin@example.com',
    operatingMode: 'live'
  })
  assert.equal(settings.operatingMode, 'live')
})
