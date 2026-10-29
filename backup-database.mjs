import 'dotenv/config'
import { spawn } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

async function createBackup() {
  const mongoUri = process.env.MONGODB_URI
  if (!mongoUri) {
    throw new Error('MONGODB_URI is missing. Set it in .env or the environment before running this command.')
  }

  const backupDirectory = join(process.cwd(), 'backups')
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const archivePath = join(backupDirectory, `jabana-db-${timestamp}.archive.gz`)
  await mkdir(backupDirectory, { recursive: true })

  try {
    const exitCode = await new Promise((resolve, reject) => {
      const dump = spawn('mongodump', [
        `--uri=${mongoUri}`,
        `--archive=${archivePath}`,
        '--gzip',
      ], { stdio: 'inherit' })

      dump.once('error', reject)
      dump.once('close', (code) => resolve(code ?? 1))
    })

    if (exitCode !== 0) {
      throw new Error(`mongodump exited with code ${exitCode}. Check the MongoDB URI and network access.`)
    }
  } catch (error) {
    await rm(archivePath, { force: true })
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error('mongodump was not found. Install MongoDB Database Tools and make sure mongodump is on PATH.')
    }
    throw error
  }

  console.log(`Database backup saved to ${archivePath}`)
}

createBackup().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Database backup failed.')
  process.exitCode = 1
})
