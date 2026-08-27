


import type { Alert, Dashboard, Device, Metric, Statistics } from './types'

export interface AppSettings {
  checkIntervalSeconds: number;
  dashboardRefreshMode: string;
  latencyThresholdMs: number;
  displayName: string;
  email: string;
  operatingMode: 'live' | 'simulation';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { headers: { 'Content-Type': 'application/json' }, ...init })
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || 'Request failed')
  return response.json()
}
export const api = {
  dashboard: () => request<Dashboard>('/dashboard'),
  devices: () => request<Device[]>('/devices'),
  addDevice: (body: Partial<Device>) => request<Device>('/devices', { method: 'POST', body: JSON.stringify(body) }),
  metrics: (id: number) => request<Metric[]>(`/monitoring/${id}`),
  check: (id: number) => request<Metric>(`/monitoring/check/${id}`, { method: 'POST' }),
  statistics: (id: number, metric = 'latencyMs', method = 'zscore') => request<Statistics>(`/analytics/${id}/statistics?metric=${metric}&method=${method}`),
  alerts: () => request<Alert[]>('/alerts'),
  updateAlert: (id: number, action: 'acknowledge' | 'resolve') => request<Alert>(`/alerts/${id}/${action}`, { method: 'PUT' }),
  scenario: () => request<Dashboard>('/simulation/run', { method: 'POST' }),
  report: (period: 'daily' | 'weekly') => request<{ report: Record<string, unknown> }>(`/reports/${period}`),
  getSettings: () => request<AppSettings>('/settings'),
  updateSettings: (settings: Partial<AppSettings>) => request<AppSettings>('/settings', { method: 'PUT', body: JSON.stringify(settings) })
}
