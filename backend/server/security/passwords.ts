import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

function deriveKey(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (error, key) => {
      if (error) reject(error)
      else resolve(key)
    })
  })
}

export async function makePasswordHash(password: string): Promise<string> {
  const salt = randomBytes(16).toString('base64url')
  return `${salt}:${(await deriveKey(password, salt)).toString('base64url')}`
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, expectedValue, ...unexpectedParts] = storedHash.split(':')
  if (!salt || !expectedValue || unexpectedParts.length > 0) return false

  const expected = Buffer.from(expectedValue, 'base64url')
  const actual = await deriveKey(password, salt)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
