import { z } from 'zod'

export const settingsSchema = z.object({
  checkIntervalSeconds: z.number().int().min(5).max(3600),
  dashboardRefreshMode: z.string().min(1),
  latencyThresholdMs: z.number().int().min(1).max(5000),
  displayName: z.string().min(1).max(100),
  email: z.string().email(),
  operatingMode: z.enum(['live', 'simulation'])
})
