import { z } from 'zod'

export const reportPeriodSchema = z.enum(['daily', 'weekly'])
