import type { Device } from '../types.js'

export interface MonitorTarget {
  devices: Device[]
  check(deviceId: number): Promise<unknown>
}

type SchedulerOptions = {
  onCheckComplete?: (deviceId: number) => Promise<void> | void
  onCheckError?: (deviceId: number, error: unknown) => Promise<void> | void
}

export class MonitoringScheduler {
  private readonly timers = new Map<number, NodeJS.Timeout>()
  private readonly running = new Set<number>()
  private target: MonitorTarget | null = null
  private options: SchedulerOptions = {}
  private started = false

  start(target: MonitorTarget, options: SchedulerOptions = {}) {
    this.stop()
    this.target = target
    this.options = options
    this.started = true
    this.refresh()
  }

  stop() {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.running.clear()
    this.started = false
    this.target = null
  }

  refresh() {
    if (!this.started || !this.target) return
    const activeIds = new Set(this.target.devices.map(device => device.id))
    for (const [deviceId, timer] of this.timers) {
      if (!activeIds.has(deviceId)) {
        clearTimeout(timer)
        this.timers.delete(deviceId)
      }
    }
    for (const device of this.target.devices) {
      if (!this.timers.has(device.id) && !this.running.has(device.id)) this.schedule(device.id, 0)
    }
  }

  isRunning(deviceId: number) { return this.running.has(deviceId) }
  scheduledDeviceIds() { return [...this.timers.keys()].sort((left, right) => left - right) }

  private schedule(deviceId: number, delayMs: number) {
    const timer = setTimeout(() => {
      this.timers.delete(deviceId)
      void this.run(deviceId)
    }, delayMs)
    timer.unref()
    this.timers.set(deviceId, timer)
  }

  private async run(deviceId: number) {
    if (!this.started || !this.target || this.running.has(deviceId)) return
    const device = this.target.devices.find(item => item.id === deviceId)
    if (!device) return
    this.running.add(deviceId)
    try {
      await this.target.check(deviceId)
      await this.options.onCheckComplete?.(deviceId)
    } catch (error) {
      await this.options.onCheckError?.(deviceId, error)
    } finally {
      this.running.delete(deviceId)
      if (this.started && this.target?.devices.some(item => item.id === deviceId)) {
        const current = this.target.devices.find(item => item.id === deviceId)
        this.schedule(deviceId, Math.max(1, (current?.monitoringInterval || 30) * 1000))
      }
    }
  }
}
