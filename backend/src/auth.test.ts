import assert from 'node:assert/strict'
import test from 'node:test'
import type { NextFunction, Request, Response } from 'express'
import { authenticate, issueToken, loginRateLimit, requireRole } from './auth.js'

process.env.JWT_SECRET = 'test-secret-with-enough-entropy'

const response = () => {
  let statusCode = 200
  let body: unknown
  const headers = new Map<string, string>()
  return {
    value: {
      status(code: number) { statusCode = code; return this },
      json(value: unknown) { body = value; return this },
      setHeader(name: string, value: string | number) { headers.set(name, String(value)); return this }
    } as unknown as Response,
    get statusCode() { return statusCode },
    get body() { return body },
    headers
  }
}

test('authenticates a valid bearer token and attaches the user', () => {
  const token = issueToken({ id: '1', email: 'admin@example.com', name: 'Admin', role: 'admin' })
  const request = { header: (name: string) => name === 'authorization' ? `Bearer ${token}` : undefined } as unknown as Request
  const result = response()
  let called = false
  authenticate(request, result.value, (() => { called = true }) as NextFunction)
  assert.equal(called, true)
  assert.equal(request.user?.role, 'admin')
})

test('rejects requests without a valid token', () => {
  const request = { header: () => 'Bearer invalid-token' } as unknown as Request
  const result = response()
  authenticate(request, result.value, (() => { throw new Error('next should not be called') }) as NextFunction)
  assert.equal(result.statusCode, 401)
})

test('enforces administrator role for protected mutations', () => {
  const request = { user: { id: '2', email: 'viewer@example.com', name: 'Viewer', role: 'viewer' } } as unknown as Request
  const result = response()
  let called = false
  requireRole('admin')(request, result.value, (() => { called = true }) as NextFunction)
  assert.equal(called, false)
  assert.equal(result.statusCode, 403)
})

test('limits repeated login attempts for the same IP and email', () => {
  const request = { ip: '127.0.0.9', body: { email: 'blocked@example.com' } } as unknown as Request
  let limited = false
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const result = response()
    loginRateLimit(request, result.value, (() => undefined) as NextFunction)
    if (result.statusCode === 429) limited = true
  }
  assert.equal(limited, true)
})
