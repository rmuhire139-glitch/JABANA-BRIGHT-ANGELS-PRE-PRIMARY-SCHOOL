import { createHash, randomBytes } from 'node:crypto'
import { SchoolSession } from '../models.js'

const sessionCookie = 'jabana_session'
const sessionLifetimeMs = 8 * 60 * 60 * 1000
export type CookieSameSite = 'Lax' | 'None'

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function sessionCookieHeader(token: string, secure: boolean, sameSite: CookieSameSite): string {
  return `${sessionCookie}=${token}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${sessionLifetimeMs / 1000}${secure ? '; Secure' : ''}`
}

export function getSessionToken(requestCookie: string | undefined): string | undefined {
  return requestCookie?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookie}=`))
    ?.slice(sessionCookie.length + 1)
}

export function clearSessionCookie(secure: boolean, sameSite: CookieSameSite): string {
  return `${sessionCookie}=; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=0${secure ? '; Secure' : ''}`
}

export async function createSession(
  userId: string,
  authVersion: number,
  secure: boolean,
  sameSite: CookieSameSite,
): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await SchoolSession.create({
    userId,
    authVersion,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + sessionLifetimeMs),
  })
  return sessionCookieHeader(token, secure, sameSite)
}

export function findSession(token: string) {
  return SchoolSession.findOne({
    tokenHash: hashToken(token),
    expiresAt: { $gt: new Date() },
  }).lean()
}

export async function deleteCurrentSession(requestCookie: string | undefined): Promise<void> {
  const token = getSessionToken(requestCookie)
  if (token) await SchoolSession.deleteOne({ tokenHash: hashToken(token) })
}
