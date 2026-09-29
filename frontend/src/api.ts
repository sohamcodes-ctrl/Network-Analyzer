


import type { Alert, Dashboard, Device, HotspotSnapshot, Metric, Statistics } from './types'

export interface AppSettings {
  checkIntervalSeconds: number;
  dashboardRefreshMode: string;
  latencyThresholdMs: number;
  displayName: string;
  email: string;
  operatingMode: 'live' | 'simulation';
}

export type AuthUser = { id: string; email: string; name: string; role: 'admin' | 'viewer' }
export type AuthResponse = { token: string; user: AuthUser }

const tokenKey = 'network-monitoring-token'
const getToken = () => sessionStorage.getItem(tokenKey)
const setToken = (token: string) => sessionStorage.setItem(tokenKey, token)
const clearToken = () => sessionStorage.removeItem(tokenKey)

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('Content-Type', 'application/json')
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(`/api${path}`, { ...init, headers })
  if (response.status === 401 && path !== '/auth/login') {
    clearToken()
    window.dispatchEvent(new Event('auth-expired'))
  }
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || 'Request failed')
  if (response.status === 204) return undefined as T
  return response.json()
}
export const api = {
  login: async (email: string, password: string) => {
    const result = await request<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
    setToken(result.token)
    return result.user
  },
  logout: async () => {
    try { await request<void>('/auth/logout', { method: 'POST' }) } finally { clearToken() }
  },
  hasSession: () => Boolean(getToken()),
  dashboard: () => request<Dashboard>('/dashboard'),
  hotspotClients: () => request<HotspotSnapshot>('/hotspot/clients'),
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
