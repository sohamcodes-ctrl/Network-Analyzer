import { z } from 'zod'

export const analyticsMetricSchema = z.enum(['latencyMs', 'packetLossPercent', 'downloadMbps', 'uploadMbps', 'availabilityPercent'])
export const anomalyMethodSchema = z.enum(['zscore', 'iqr'])
