import 'dotenv/config'
import mongoose from 'mongoose'
import { makePasswordHash } from './auth.js'
import { SchoolUser } from './models.js'

async function createInitialAdministrator() {
  const mongoUri = process.env.MONGODB_URI
  const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase()
  const password = process.env.INITIAL_ADMIN_PASSWORD
  if (!mongoUri || !email || !password) {
    throw new Error('Set MONGODB_URI, INITIAL_ADMIN_EMAIL, and INITIAL_ADMIN_PASSWORD before creating an administrator.')
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('INITIAL_ADMIN_EMAIL must be a valid email address.')
  if (password.length < 12) throw new Error('INITIAL_ADMIN_PASSWORD must contain at least 12 characters.')

  await mongoose.connect(mongoUri)
  if (await SchoolUser.exists({ email })) throw new Error('An account with INITIAL_ADMIN_EMAIL already exists.')
  await SchoolUser.create({ email, passwordHash: await makePasswordHash(password), role: 'administrator' })
  console.log(`Administrator account created for ${email}.`)
}

createInitialAdministrator()
  .catch((error: unknown) => {
    console.error('Could not create the initial administrator:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await mongoose.disconnect()
  })
