import { z } from 'zod'

export const deviceIdSchema = z.coerce.number().int().positive()
export const deviceSchema = z.object({
  name: z.string().min(2).max(80),
  address: z.string().min(2).max(253),
  type: z.string().min(1).max(40).optional(),
  location: z.string().max(150).optional(),
  monitoringInterval: z.number().int().min(5).max(3600).optional()
})
