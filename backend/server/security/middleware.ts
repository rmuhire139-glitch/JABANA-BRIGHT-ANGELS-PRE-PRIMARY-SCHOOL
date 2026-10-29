import type { RequestHandler } from 'express'
import { SchoolUser, type SchoolRole } from '../models.js'
import { findSession, getSessionToken } from './sessions.js'

export interface AuthenticatedUser {
  id: string
  email: string
  role: SchoolRole
}

declare global {
  namespace Express {
    interface Request {
      schoolUser?: AuthenticatedUser
    }
  }
}

function isSchoolRole(role: string): role is SchoolRole {
  return role === 'administrator' ||
    role === 'dos' ||
    role === 'teacher' ||
    role === 'dos_teacher' ||
    role === 'accountant'
}

export const requireAuthentication: RequestHandler = async (request, response, next) => {
  const token = getSessionToken(request.headers.cookie)
  if (!token) {
    response.status(401).json({ message: 'Sign in is required.' })
    return
  }

  const session = await findSession(token)
  if (!session) {
    response.status(401).json({ message: 'Your session has expired. Please sign in again.' })
    return
  }

  const user = await SchoolUser.findOne({ _id: session.userId, active: true }).lean()
  if (!user || user.authVersion !== session.authVersion || !isSchoolRole(user.role)) {
    response.status(401).json({ message: 'This account is unavailable.' })
    return
  }

  request.schoolUser = {
    id: String(user._id),
    email: user.email,
    role: user.role,
  }
  next()
}

export function requireRole(...roles: SchoolRole[]): RequestHandler {
  return (request, response, next) => {
    if (!request.schoolUser) {
      response.status(401).json({ message: 'Sign in is required.' })
      return
    }
    if (!roles.includes(request.schoolUser.role)) {
      response.status(403).json({ message: 'Your account is not authorized to access this feature.' })
      return
    }
    next()
  }
}
