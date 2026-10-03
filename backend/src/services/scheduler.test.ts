import assert from 'node:assert/strict'
import test from 'node:test'
import type { Device } from '../types.js'
import { MonitoringScheduler } from './scheduler.js'

const device: Device = {
  id: 7,
  name: 'Test device',
  address: '127.0.0.1',
  type: 'Computer',
  location: 'Test',
  status: 'online',
  monitoringInterval: 5,
  createdAt: new Date().toISOString(),
  lastChecked: new Date().toISOString(),
  latest: { timestamp: new Date().toISOString(), latencyMs: 1, packetLossPercent: 0, downloadMbps: 1, uploadMbps: 1, availabilityPercent: 100, errorCount: 0, responseTimeMs: 1 }
}

test('does not overlap checks when the scheduler is refreshed mid-probe', async () => {
  let calls = 0
  let release: (() => void) | undefined
  const target = {
    devices: [device],
    check: async () => {
      calls += 1
      await new Promise<void>(resolve => { release = resolve })
    }
  }
  const scheduler = new MonitoringScheduler()
  scheduler.start(target)
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(calls, 1)
  assert.equal(scheduler.isRunning(device.id), true)
  scheduler.refresh()
  assert.equal(calls, 1)
  release?.()
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(scheduler.isRunning(device.id), false)
  scheduler.stop()
})
