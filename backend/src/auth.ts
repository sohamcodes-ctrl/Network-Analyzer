import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { z } from 'zod'

export type UserRole = 'admin' | 'viewer'

export type AuthUser = {
  id: string
  email: string
  name: string
  role: UserRole
}

type JwtClaims = {
  id: string
  email: string
  name: string
  role: UserRole
}

const claimsSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(['admin', 'viewer'])
})

const getSecret = () => {
  const secret = process.env.JWT_SECRET?.trim()
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be configured in production')
  }
  return secret || 'development-only-change-me'
}

export const issueToken = (user: AuthUser) => jwt.sign(user, getSecret(), { expiresIn: '8h' })

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const header = req.header('authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) {
    res.status(401).json({ message: 'Authentication required' })
    return
  }

  try {
    const claims = claimsSchema.parse(jwt.verify(token, getSecret()))
    req.user = claims
    next()
  } catch {
    res.status(401).json({ message: 'Invalid or expired authentication token' })
  }
}

export const requireRole = (...roles: UserRole[]) => (req: Request, res: Response, next: NextFunction) => {
  if (!req.user || !roles.includes(req.user.role)) {
    res.status(403).json({ message: 'Administrator access required' })
    return
  }
  next()
}

type LoginAttempt = { count: number; resetAt: number }
const attempts = new Map<string, LoginAttempt>()
const windowMs = 15 * 60 * 1000
const maxAttempts = 5

export const loginRateLimit = (req: Request, res: Response, next: NextFunction) => {
  const key = `${req.ip}:${typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : ''}`
  const now = Date.now()
  const current = attempts.get(key)
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs })
    next()
    return
  }

  current.count += 1
  if (current.count > maxAttempts) {
    res.setHeader('Retry-After', Math.ceil((current.resetAt - now) / 1000))
    res.status(429).json({ message: 'Too many login attempts. Try again later.' })
    return
  }
  next()
}

export const clearExpiredLoginAttempts = () => {
  const now = Date.now()
  for (const [key, attempt] of attempts) {
    if (attempt.resetAt <= now) attempts.delete(key)
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}
