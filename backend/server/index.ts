import 'dotenv/config'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto'
import cors from 'cors'
import express, { type ErrorRequestHandler, type Request, type Response } from 'express'
import { resolve } from 'node:path'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import mongoose from 'mongoose'
import nodemailer from 'nodemailer'
import {
  clearSessionCookie,
  createSession,
  deleteCurrentSession,
  makePasswordHash,
  requireAuthentication,
  requireRole,
  verifyPassword,
} from './auth.js'
import {
  generateTimetable,
  parseMarksCsv,
  type ScheduleAssignment,
} from './academic.js'
import {
  AdmissionInquiry,
  ClassTimetable,
  ContactMessage,
  FeeSchedule,
  FeeAnnouncement,
  GoogleOAuthState,
  PasswordRecovery,
  SchoolEmailConnection,
  SchoolUser,
  Student,
  StudentFee,
  StudentMark,
  StockItem,
  TeachingAssignment,
  SchoolSession,
  TaskState,
  type SchoolRole,
} from './models.js'

const app = express()
const port = Number(process.env.PORT ?? 3000)
const mongoUri = process.env.MONGODB_URI
const frontendOrigin = process.env.FRONTEND_URL?.trim()
  || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:5173')
const secureCookies = process.env.NODE_ENV === 'production'
const cookieSameSite = process.env.SESSION_COOKIE_SAME_SITE === 'None' && secureCookies ? 'None' : 'Lax'
let databaseConnection: Promise<typeof mongoose> | undefined
const schoolName = process.env.SCHOOL_NAME?.trim() || 'JABANA BRIGHT ANGELS PRE AND PRIMARY SCHOOL'
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const roles: SchoolRole[] = ['administrator', 'dos', 'teacher', 'dos_teacher', 'accountant']
const grades = ['Nursery 1', 'Nursery 2', 'Nursery 3', 'Primary 1', 'Primary 2', 'Primary 3', 'Primary 4'] as const
type SchoolGrade = (typeof grades)[number]
const terms = ['Term 1', 'Term 2', 'Term 3']
const teacherCourses = [
  'Kinyarwanda',
  'French',
  'Social Studies',
  'Religious Education',
  'Maths',
  'English',
  'Science',
  'Art and Drama',
  'Creative Arts',
  'Science and Elementary Technology (SET)',
  'Social & Religious Studies',
]
const taskDefinitions = [
  { key: 'verify-class-lists', title: 'Verify class lists', deadline: null },
  { key: 'enter-assessment-marks', title: 'Enter assessment marks', deadline: null },
  { key: 'review-assessment-records', title: 'Review assessment records', deadline: null },
  { key: 'prepare-reports', title: 'Prepare reports', deadline: null },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSchoolRole(value: unknown): value is SchoolRole {
  return typeof value === 'string' && roles.includes(value as SchoolRole)
}

function isSchoolGrade(value: string): value is SchoolGrade {
  return (grades as readonly string[]).includes(value)
}

function textField(body: Record<string, unknown>, key: string, maximum: number): string | null {
  const value = body[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= maximum ? trimmed : null
}

function optionalTextField(body: Record<string, unknown>, key: string, maximum: number): string | null {
  const value = body[key]
  if (value === undefined) return ''
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length <= maximum ? trimmed : null
}

function isEmailAuthenticationError(error: unknown): boolean {
  return isRecord(error) && (
    error.code === 'EAUTH' ||
    error.responseCode === 535 ||
    error.responseCode === 534
  )
}

function numberField(body: Record<string, unknown>, key: string, minimum: number, maximum: number): number | null {
  const value = body[key]
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : null
}

function subjectKey(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (normalized === 'mathematics') return 'maths'
  if (['scienceandelementarytechnologyset', 'scienceandelementarytechnology', 'set'].includes(normalized)) return 'science'
  if (normalized === 'socialreligiousstudies') return 'socialandreligious'
  if (normalized === 'creativearts') return 'arts'
  if (normalized === 'artanddrama') return 'arts'
  return normalized
}

function subjectMatches(course: string, importedSubject: string) {
  const courseKey = subjectKey(course)
  const subject = subjectKey(importedSubject)
  return courseKey === subject ||
    subject === 'socialandreligious' && ['socialstudies', 'religiouseducation'].includes(courseKey) ||
    courseKey === 'socialandreligious' && ['socialstudies', 'religiouseducation'].includes(subject)
}

function subjectNameAliases(course: string) {
  const key = subjectKey(course)
  if (key === 'maths') return ['Maths', 'Mathematics']
  if (key === 'science') return ['Science', 'Science and Elementary Technology (SET)', 'Science and Elementary Technology', 'SET']
  if (key === 'socialandreligious' || key === 'socialstudies' || key === 'religiouseducation') return ['Social & Religious Studies', 'Social and Religious Studies', 'Social Studies', 'Religious Education']
  if (key === 'arts') return ['Creative Arts', 'Art and Drama']
  return [course]
}

function publicUser(user: { _id: unknown; email: string; role: string; active: boolean; createdAt?: Date }) {
  return {
    id: String(user._id),
    email: user.email,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt,
  }
}

function ensureSameOrigin(request: Request, response: Response, next: () => void) {
  const requestOrigin = request.get('origin')
  if (requestOrigin && requestOrigin !== frontendOrigin) {
    response.status(403).json({ message: 'Request origin is not allowed.' })
    return
  }
  next()
}

function connectToDatabase() {
  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose)
  if (!mongoUri) return Promise.reject(new Error('MONGODB_URI is required.'))
  if (!databaseConnection) {
    databaseConnection = mongoose.connect(mongoUri).catch((error: unknown) => {
      databaseConnection = undefined
      throw error
    })
  }
  return databaseConnection
}

app.disable('x-powered-by')
if (process.env.VERCEL === '1') app.set('trust proxy', 1)
app.use(helmet())
app.use(cors({ origin: frontendOrigin, credentials: true }))
app.use(express.json({ limit: '10kb' }))
app.use('/api', ensureSameOrigin, async (_request, _response, next) => {
  try {
    await connectToDatabase()
    next()
  } catch (error) {
    next(error)
  }
})

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many sign-in attempts. Please wait before trying again.' },
})
const publicFormLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many requests. Please wait before trying again.' },
})
const recoveryRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many recovery requests. Please wait before trying again.' },
})
const recoveryVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many verification attempts. Please wait before trying again.' },
})

function passwordRecoveryMailer() {
  const host = process.env.SMTP_HOST?.trim()
  const port = Number(process.env.SMTP_PORT ?? 587)
  const from = process.env.SMTP_FROM?.trim()
  const user = process.env.SMTP_USER?.trim()
  const password = process.env.SMTP_PASSWORD
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !from || Boolean(user) !== Boolean(password)) {
    return null
  }
  return {
    from,
    transport: nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      ...(user && password ? { auth: { user, pass: password } } : {}),
    }),
  }
}

function googleOAuthConfiguration() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim()
  const encryptionKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim()
  if (!clientId || !clientSecret || !redirectUri || !encryptionKey) return null
  const decodedKey = Buffer.from(encryptionKey, 'base64')
  if (decodedKey.length !== 32) return null
  return { clientId, clientSecret, redirectUri, encryptionKey: decodedKey }
}

function googleOAuthMissingSettings() {
  const required = [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_OAUTH_REDIRECT_URI',
    'GOOGLE_TOKEN_ENCRYPTION_KEY',
  ]
  return required.filter((key) => !process.env[key]?.trim())
}

function encryptGoogleRefreshToken(refreshToken: string, key: Buffer) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(refreshToken, 'utf8'), cipher.final()])
  return {
    encryptedRefreshToken: encrypted.toString('base64'),
    tokenIv: iv.toString('base64'),
    tokenAuthTag: cipher.getAuthTag().toString('base64'),
  }
}

async function schoolEmailMailer() {
  const config = googleOAuthConfiguration()
  if (!config) return null
  const connection = await SchoolEmailConnection.findOne({ key: 'school' }).lean()
  if (!connection) return null
  const decipher = createDecipheriv('aes-256-gcm', config.encryptionKey, Buffer.from(connection.tokenIv, 'base64'))
  decipher.setAuthTag(Buffer.from(connection.tokenAuthTag, 'base64'))
  const refreshToken = Buffer.concat([
    decipher.update(Buffer.from(connection.encryptedRefreshToken, 'base64')),
    decipher.final(),
  ]).toString('utf8')
  return {
    from: connection.email,
    transport: nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: connection.email,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        refreshToken,
      },
    }),
  }
}

async function sendRegistrationConfirmation(email: string, subject: string, text: string) {
  const mailer = await schoolEmailMailer()
  if (!mailer) {
    return { sent: false, message: 'No working SMTP or connected Gmail email service is available.' }
  }
  try {
    await mailer.transport.sendMail({
      from: mailer.from,
      to: email,
      replyTo: mailer.from,
      subject,
      text,
    })
    return { sent: true, message: `Confirmation sent to ${email}.` }
  } catch (error) {
    console.error(`Registration confirmation email to ${email} could not be sent.`)
    if (error instanceof Error) console.error(error.message)
    return {
      sent: false,
      message: isEmailAuthenticationError(error)
        ? 'The account was created, but email authentication failed. Correct SMTP credentials or reconnect Gmail.'
        : 'The account was created, but its confirmation email could not be delivered.',
    }
  }
}

app.get('/api/health', (_request, response) => {
  const connected = mongoose.connection.readyState === 1
  response.status(connected ? 200 : 503).json({ status: connected ? 'ok' : 'database unavailable' })
})

app.get('/api/announcements', async (_request, response) => {
  const announcements = await FeeAnnouncement.find({ published: true })
    .select('title body createdAt createdBy')
    .populate('createdBy', 'role')
    .sort({ createdAt: -1 })
    .limit(10)
    .lean()
  response.json({
    announcements: announcements.map((announcement) => {
      const creator = announcement.createdBy as unknown as { role?: string } | null
      return {
        id: String(announcement._id),
        title: announcement.title,
        body: announcement.body,
        createdAt: announcement.createdAt,
        authorRole: creator?.role ?? 'school',
      }
    }),
  })
})

app.get(
  '/api/announcements/manage',
  requireAuthentication,
  requireRole('accountant', 'administrator'),
  async (_request, response) => {
    const announcements = await FeeAnnouncement.find().sort({ createdAt: -1 }).lean()
    response.json({
      announcements: announcements.map((announcement) => ({
        id: String(announcement._id),
        title: announcement.title,
        body: announcement.body,
        published: announcement.published,
        createdAt: announcement.createdAt,
      })),
    })
  },
)

app.post(
  '/api/announcements',
  requireAuthentication,
  requireRole('accountant', 'administrator'),
  async (request, response) => {
    if (!isRecord(request.body)) {
      response.status(400).json({ message: 'Enter an announcement title and message.' })
      return
    }
    const title = textField(request.body, 'title', 120)
    const body = textField(request.body, 'body', 1500)
    if (!title || !body) {
      response.status(400).json({ message: 'Enter a title and message for the announcement.' })
      return
    }
    const announcement = await FeeAnnouncement.create({
      title,
      body,
      createdBy: request.schoolUser!.id,
      published: true,
    })
    response.status(201).json({ announcement: { id: String(announcement._id), published: announcement.published } })
  },
)

app.patch(
  '/api/announcements/:announcementId',
  requireAuthentication,
  requireRole('accountant', 'administrator'),
  async (request, response) => {
    if (!mongoose.isValidObjectId(request.params.announcementId) || !isRecord(request.body) || typeof request.body.published !== 'boolean') {
      response.status(400).json({ message: 'Choose a valid announcement publication status.' })
      return
    }
    const announcement = await FeeAnnouncement.findByIdAndUpdate(
      request.params.announcementId,
      { $set: { published: request.body.published } },
      { new: true, runValidators: true },
    )
    if (!announcement) {
      response.status(404).json({ message: 'Announcement not found.' })
      return
    }
    response.json({ announcement: { id: String(announcement._id), published: announcement.published } })
  },
)

app.get(
  '/api/dos/gmail/status',
  requireAuthentication,
  requireRole('dos', 'dos_teacher', 'administrator'),
  async (_request, response) => {
    const config = googleOAuthConfiguration()
    const missingSettings = googleOAuthMissingSettings()
    const connection = await SchoolEmailConnection.findOne({ key: 'school' }).select('email connectedAt').lean()
    const gmailAvailable = Boolean(config && connection)
    response.json({
      configured: Boolean(config),
      missingSettings: config ? [] : missingSettings.length ? missingSettings : ['GOOGLE_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key'],
      connected: gmailAvailable,
      method: gmailAvailable ? 'gmail' : null,
      email: connection?.email ?? null,
      connectedAt: connection?.connectedAt ?? null,
      connectionError: null,
    })
  },
)

app.get(
  '/api/dos/gmail/connect',
  requireAuthentication,
  requireRole('dos', 'dos_teacher', 'administrator'),
  async (request, response) => {
    const config = googleOAuthConfiguration()
    if (!config) {
      response.status(503).json({
        message: 'Gmail OAuth is not configured. Add the Google OAuth settings to the server environment first.',
        missingSettings: googleOAuthMissingSettings(),
      })
      return
    }
    const state = randomBytes(32).toString('base64url')
    await GoogleOAuthState.create({
      userId: request.schoolUser!.id,
      stateHash: createHash('sha256').update(state).digest('hex'),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    })
    const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    authorizationUrl.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: 'openid email https://www.googleapis.com/auth/gmail.send',
      access_type: 'offline',
      prompt: 'select_account consent',
      state,
    }).toString()
    response.redirect(authorizationUrl.toString())
  },
)

app.get('/api/oauth/google/callback', async (request, response) => {
  const config = googleOAuthConfiguration()
  const state = typeof request.query.state === 'string' ? request.query.state : ''
  const code = typeof request.query.code === 'string' ? request.query.code : ''
  const oauthError = typeof request.query.error === 'string' ? request.query.error : ''
  const fail = (reason: string) => response.redirect(`${frontendOrigin}/academic-management?gmail=${encodeURIComponent(reason)}`)
  if (!config) {
    fail('not-configured')
    return
  }
  if (oauthError || !state || !code) {
    fail(oauthError === 'access_denied' ? 'cancelled' : 'authorization-failed')
    return
  }
  const stateHash = createHash('sha256').update(state).digest('hex')
  const oauthState = await GoogleOAuthState.findOneAndDelete({
    stateHash,
    expiresAt: { $gt: new Date() },
  }).lean()
  if (!oauthState) {
    fail('state-expired')
    return
  }
  const user = await SchoolUser.findOne({
    _id: oauthState.userId,
    active: true,
    role: { $in: ['dos', 'dos_teacher', 'administrator'] },
  }).select('_id').lean()
  if (!user) {
    fail('account-unavailable')
    return
  }
  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
      }),
    })
    const tokens = await tokenResponse.json() as {
      access_token?: string
      refresh_token?: string
    }
    if (!tokenResponse.ok || !tokens.access_token || !tokens.refresh_token) {
      fail('token-exchange-failed')
      return
    }
    const userInfoResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const userInfo = await userInfoResponse.json() as { email?: string; email_verified?: boolean }
    if (!userInfoResponse.ok || !userInfo.email || !emailPattern.test(userInfo.email) || !userInfo.email_verified) {
      fail('email-verification-failed')
      return
    }
    const encryptedToken = encryptGoogleRefreshToken(tokens.refresh_token, config.encryptionKey)
    await SchoolEmailConnection.findOneAndUpdate(
      { key: 'school' },
      {
        $set: {
          key: 'school',
          email: userInfo.email.toLowerCase(),
          ...encryptedToken,
          connectedBy: user._id,
          connectedAt: new Date(),
        },
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    )
    response.redirect(`${frontendOrigin}/academic-management?gmail=connected`)
  } catch (error) {
    console.error('Google Gmail OAuth connection failed.')
    if (error instanceof Error) console.error(error.message)
    fail('connection-failed')
  }
})

app.delete(
  '/api/dos/gmail/connection',
  requireAuthentication,
  requireRole('dos', 'dos_teacher', 'administrator'),
  async (_request, response) => {
    await SchoolEmailConnection.deleteOne({ key: 'school' })
    response.status(204).end()
  },
)

app.post('/api/contact', publicFormLimiter, async (request, response) => {
  if (!isRecord(request.body)) {
    response.status(400).json({ message: 'Please check the submitted information and try again.' })
    return
  }
  const name = textField(request.body, 'name', 100)
  const email = textField(request.body, 'email', 254)?.toLowerCase()
  const subject = textField(request.body, 'subject', 150)
  const message = textField(request.body, 'message', 3000)
  if (!name || !email || !emailPattern.test(email) || !subject || !message) {
    response.status(400).json({ message: 'Please check the submitted information and try again.' })
    return
  }
  await ContactMessage.create({ name, email, subject, message })
  const mailer = await schoolEmailMailer()
  if (!mailer) {
    response.status(201).json({
      message: 'Your question was received, but school email is unavailable. Check SMTP authentication or connect the school Gmail account.',
      confirmationSent: false,
    })
    return
  }
  const staffRecipients = await SchoolUser.find({
    role: { $in: ['administrator', 'dos', 'dos_teacher', 'accountant'] },
    active: true,
  }).sort({ role: 1 }).select('email role').lean()
  const notificationEmails = [...new Set(staffRecipients.map((staff) => staff.email.toLowerCase()))]
  const emailResults = await Promise.allSettled([
    mailer.transport.sendMail({
      from: mailer.from,
      to: email,
      replyTo: mailer.from,
      subject: `We received your message: ${subject.replace(/[\r\n]+/g, ' ').slice(0, 150)}`,
      text: `Hello ${name},\n\nThank you for contacting ${schoolName}. We have received your message and the Director of Studies will review it and reply as soon as possible.\n\nYour message: ${message}\n\nDirector of Studies\n${schoolName}`,
    }),
    ...(notificationEmails.length ? [mailer.transport.sendMail({
      from: mailer.from,
      to: notificationEmails,
      replyTo: email,
      subject: `New website question from ${name}: ${subject.replace(/[\r\n]+/g, ' ').slice(0, 120)}`,
      text: `A new question was submitted on the school website.\n\nFrom: ${name} <${email}>\nSubject: ${subject}\n\n${message}\n\nReply to this email to respond directly to ${name}.\n\nNotified school roles: ${staffRecipients.map((staff) => staff.role).join(', ')}.`,
    })] : []),
  ])
  const [confirmationResult, adminNotificationResult] = emailResults
  if (confirmationResult.status === 'rejected') {
    console.error('Automatic contact-question confirmation email delivery failed.')
    if (confirmationResult.reason instanceof Error) console.error(confirmationResult.reason.message)
  }
  if (adminNotificationResult?.status === 'rejected') {
    console.error('Contact-question notification to the initial administrator email failed.')
    if (adminNotificationResult.reason instanceof Error) console.error(adminNotificationResult.reason.message)
  }
  const confirmationSent = confirmationResult.status === 'fulfilled'
  const staffNotified = notificationEmails.length > 0 && adminNotificationResult?.status === 'fulfilled'
  const messageText = confirmationSent
    ? `Your question was received and an automatic confirmation was sent from ${mailer.from}.${staffNotified ? ' The school team was notified.' : ' The school team notification was not sent; check that active staff accounts exist.'}`
    : isEmailAuthenticationError(confirmationResult.reason)
      ? 'Your question was received, but the email provider rejected the configured login. Check SMTP_USER and SMTP_PASSWORD; for Gmail use a valid App Password.'
      : 'Your question was received, but the automatic confirmation could not be delivered. The school will still review your question.'
  response.status(201).json({ message: messageText, confirmationSent, staffNotified })
})

app.post(
  '/api/dos/contact-questions/:questionId/reply',
  requireAuthentication,
  requireRole('dos', 'dos_teacher', 'administrator'),
  async (request, response) => {
    if (!mongoose.isValidObjectId(request.params.questionId) || !isRecord(request.body)) {
      response.status(400).json({ message: 'Choose a valid user question and enter a reply.' })
      return
    }
    const reply = textField(request.body, 'reply', 3000)
    if (!reply) {
      response.status(400).json({ message: 'Enter a reply of up to 3,000 characters.' })
      return
    }
    const mailer = await schoolEmailMailer()
    if (!mailer) {
      response.status(503).json({ message: 'No working school email service is available. Correct SMTP authentication or connect the DOS Gmail account before sending replies.' })
      return
    }
    const question = await ContactMessage.findById(request.params.questionId).select('name email subject message').lean()
    if (!question) {
      response.status(404).json({ message: 'User question not found.' })
      return
    }
    try {
      await mailer.transport.sendMail({
        from: mailer.from,
        to: question.email,
        replyTo: request.schoolUser!.email,
        subject: `Re: ${question.subject.replace(/[\r\n]+/g, ' ').slice(0, 150)}`,
        text: `Hello ${question.name},\n\n${reply}\n\n---\nYour original message: ${question.message}\n\n${schoolName}\nDirector of Studies`,
      })
    } catch (mailError) {
      console.error(`Could not send a reply to contact question ${String(question._id)}.`)
      if (mailError instanceof Error) console.error(mailError.message)
      response.status(502).json({
        message: isEmailAuthenticationError(mailError)
          ? 'The configured email server rejected SMTP authentication. Check SMTP_USER and SMTP_PASSWORD; for Gmail use a valid App Password. Your reply was not sent.'
          : 'The email could not be sent. Check the connected Gmail account and try again.',
      })
      return
    }
    response.json({
      message: `Reply email sent from ${mailer.from} to ${question.email}. Replies will go to ${request.schoolUser!.email}.`,
      sender: mailer.from,
      recipient: question.email,
    })
  },
)

app.patch(
  '/api/dos/contact-questions/:questionId/dismiss',
  requireAuthentication,
  requireRole('dos', 'dos_teacher', 'administrator'),
  async (request, response) => {
    if (!mongoose.isValidObjectId(request.params.questionId)) {
      response.status(400).json({ message: 'Choose a valid user question to dismiss.' })
      return
    }
    const question = await ContactMessage.findOneAndUpdate(
      { _id: request.params.questionId, dismissedAt: null },
      { $set: { dismissedAt: new Date() } },
      { new: true },
    ).select('_id').lean()
    if (!question) {
      if (await ContactMessage.exists({ _id: request.params.questionId })) {
        response.status(409).json({ message: 'This user question has already been dismissed.' })
      } else {
        response.status(404).json({ message: 'User question not found.' })
      }
      return
    }
    response.json({ message: 'User question dismissed.' })
  },
)

app.post('/api/admissions', publicFormLimiter, async (request, response) => {
  if (!isRecord(request.body)) {
    response.status(400).json({ message: 'Please check the submitted information and try again.' })
    return
  }
  const studentName = textField(request.body, 'studentName', 100)
  const grade = textField(request.body, 'grade', 30)
  const guardianName = textField(request.body, 'guardianName', 100)
  const email = textField(request.body, 'email', 254)?.toLowerCase()
  const phone = textField(request.body, 'phone', 30)
  const optionalMessage = request.body.message === undefined
    ? ''
    : typeof request.body.message === 'string' && request.body.message.trim().length <= 2000
      ? request.body.message.trim()
      : null
  if (
    !studentName || !grade ||
    !grades.includes(grade as SchoolGrade) ||
    !guardianName || !email || !emailPattern.test(email) || !phone || optionalMessage === null
  ) {
    response.status(400).json({ message: 'Please check the submitted information and try again.' })
    return
  }
  await AdmissionInquiry.create({ studentName, grade, guardianName, email, phone, message: optionalMessage })
  response.status(201).json({ message: 'Admission inquiry received.' })
})

app.post('/api/auth/login', loginLimiter, async (request, response) => {
  if (!isRecord(request.body)) {
    response.status(400).json({ message: 'Enter your school email and password.' })
    return
  }
  const email = textField(request.body, 'email', 254)?.toLowerCase()
  const password = request.body.password
  if (!email || !emailPattern.test(email) || typeof password !== 'string' || password.length > 256) {
    response.status(400).json({ message: 'Enter your school email and password.' })
    return
  }

  const user = await SchoolUser.findOne({ email, active: true })
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    response.status(401).json({ message: 'Email or password is incorrect.' })
    return
  }

  response.setHeader('Set-Cookie', await createSession(String(user._id), user.authVersion, secureCookies, cookieSameSite))
  response.json({ user: publicUser(user) })
})

app.post('/api/auth/password-recovery/request', recoveryRequestLimiter, async (request, response) => {
  const mailer = passwordRecoveryMailer()
  if (!mailer) {
    response.status(503).json({ message: 'The school email delivery service is not configured. Contact your administrator; recovery codes are sent to the email registered on your staff account.' })
    return
  }
  if (!isRecord(request.body)) {
    response.status(202).json({ message: 'If an active staff account matches that email, a verification code will be sent.' })
    return
  }
  const email = textField(request.body, 'email', 254)?.toLowerCase()
  if (!email || !emailPattern.test(email)) {
    response.status(202).json({ message: 'If an active staff account matches that email, a verification code will be sent.' })
    return
  }

  const user = await SchoolUser.findOne({ email, active: true }).select('_id email').lean()
  if (!user) {
    response.status(202).json({ message: 'If an active staff account matches that email, a verification code will be sent.' })
    return
  }

  const now = new Date()
  const existing = await PasswordRecovery.findOne({ userId: user._id, expiresAt: { $gt: now } })
  if (existing && now.getTime() - existing.createdAt.getTime() < 60_000) {
    response.status(202).json({ message: 'If an active staff account matches that email, a verification code will be sent.' })
    return
  }

  const code = String(randomInt(10_000_000, 100_000_000))
  const challenge = await PasswordRecovery.findOneAndUpdate(
    { userId: user._id },
    { $set: { codeHash: await makePasswordHash(code), attempts: 0, expiresAt: new Date(now.getTime() + 10 * 60 * 1000) } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
  try {
    await mailer.transport.sendMail({
      from: mailer.from,
      to: user.email,
      subject: 'Your Jabana staff password recovery code',
      text: `Your password recovery code is ${code}. It expires in 10 minutes. If you did not request this code, you can ignore this email.`,
    })
  } catch (mailError) {
    await PasswordRecovery.deleteOne({ _id: challenge._id })
    console.error('Password recovery email delivery failed.')
    if (mailError instanceof Error) console.error(mailError.message)
  }
  response.status(202).json({ message: 'If an active staff account matches that email, a verification code will be sent.' })
})

app.post('/api/auth/password-recovery/verify', recoveryVerifyLimiter, async (request, response) => {
  if (!isRecord(request.body)) {
    response.status(400).json({ message: 'The code is invalid or expired. Request another code and try again.' })
    return
  }
  const email = textField(request.body, 'email', 254)?.toLowerCase()
  const code = textField(request.body, 'code', 8)
  const newPassword = request.body.newPassword
  if (!email || !emailPattern.test(email) || !code || !/^\d{8}$/.test(code) || typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 256) {
    response.status(400).json({ message: 'Enter the 8-digit code and a new password of at least 12 characters.' })
    return
  }

  const user = await SchoolUser.findOne({ email, active: true })
  const challenge = user ? await PasswordRecovery.findOneAndUpdate(
    { userId: user._id, expiresAt: { $gt: new Date() }, attempts: { $lt: 5 } },
    { $inc: { attempts: 1 } },
    { new: true },
  ) : null
  if (!user || !challenge) {
    response.status(400).json({ message: 'The code is invalid or expired. Request another code and try again.' })
    return
  }

  if (!await verifyPassword(code, challenge.codeHash)) {
    if (challenge.attempts >= 5) await challenge.deleteOne()
    response.status(400).json({ message: 'The code is invalid or expired. Request another code and try again.' })
    return
  }

  const claimed = await PasswordRecovery.findOneAndDelete({ _id: challenge._id, expiresAt: { $gt: new Date() } })
  if (!claimed) {
    response.status(400).json({ message: 'The code is invalid or expired. Request another code and try again.' })
    return
  }
  user.passwordHash = await makePasswordHash(newPassword)
  user.authVersion += 1
  await user.save()
  response.json({ message: 'Your password has been reset. Sign in with your new password.' })
})

app.get('/api/auth/session', requireAuthentication, (request, response) => {
  response.json({ user: request.schoolUser })
})

app.post('/api/auth/password', requireAuthentication, async (request, response) => {
  if (
    !isRecord(request.body) ||
    typeof request.body.currentPassword !== 'string' ||
    typeof request.body.newPassword !== 'string' ||
    request.body.newPassword.length < 12 ||
    request.body.newPassword.length > 256
  ) {
    response.status(400).json({ message: 'Enter your current password and a new password of at least 12 characters.' })
    return
  }

  const user = await SchoolUser.findById(request.schoolUser!.id)
  if (!user || !(await verifyPassword(request.body.currentPassword, user.passwordHash))) {
    response.status(400).json({ message: 'Your current password is incorrect.' })
    return
  }
  user.passwordHash = await makePasswordHash(request.body.newPassword)
  user.authVersion += 1
  await user.save()
  response.setHeader('Set-Cookie', await createSession(String(user._id), user.authVersion, secureCookies, cookieSameSite))
  response.json({ message: 'Password updated.' })
})

app.post('/api/auth/logout', async (request, response) => {
  await deleteCurrentSession(request.headers.cookie)
  response.setHeader('Set-Cookie', clearSessionCookie(secureCookies, cookieSameSite))
  response.status(204).end()
})

app.get(
  '/api/teacher/dashboard',
  requireAuthentication,
  requireRole('teacher', 'dos_teacher'),
  async (request, response) => {
    const teacher = await SchoolUser.findById(request.schoolUser!.id).select(
      'teacherName teacherStudies teacherGroupApproved assignedCourses',
    ).lean()
    if (!teacher) {
      response.status(404).json({ message: 'Teacher account not found.' })
      return
    }
    const assignedCourses = teacher.assignedCourses ?? []
    const subjectNames = [...new Set(assignedCourses.flatMap(subjectNameAliases))]
    const [marks, timetable] = teacher.teacherGroupApproved
      ? await Promise.all([
          subjectNames.length
            ? StudentMark.find({ subjectName: { $in: subjectNames } }).sort({ academicYear: -1, term: 1, studentName: 1 }).limit(1001).lean()
            : Promise.resolve([]),
          ClassTimetable.findOne().sort({ generatedAt: -1 }).lean(),
        ])
      : [[], null]
    response.json({
      profile: {
        name: teacher.teacherName ?? '',
        studies: teacher.teacherStudies ?? '',
        approved: teacher.teacherGroupApproved ?? false,
        assignedCourses,
      },
      marks: marks.slice(0, 1000).map((mark) => ({
        id: String(mark._id),
        studentNumber: mark.studentNumber,
        studentName: mark.studentName,
        classGrade: mark.classGrade,
        subjectName: mark.subjectName,
        assessmentType: mark.assessmentType,
        assessmentName: mark.assessmentName,
        marksObtained: mark.marksObtained,
        maxMarks: mark.maxMarks,
        calculatedGrade: mark.calculatedGrade,
        gradePoints: mark.gradePoints,
        term: mark.term,
        academicYear: mark.academicYear,
        remarks: mark.remarks,
      })),
      marksTruncated: marks.length > 1000,
      timetable: timetable?.slots.filter((slot) => String(slot.teacherId) === String(teacher._id)).map((slot) => ({
        day: slot.day,
        period: slot.period,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        grade: slot.grade,
        subject: slot.subject,
      })) ?? [],
    })
  },
)

app.post(
  '/api/teacher/marks/import',
  requireAuthentication,
  requireRole('teacher', 'dos_teacher'),
  express.text({ type: ['text/csv', 'text/plain'], limit: '1mb' }),
  async (request, response) => {
    if (typeof request.body !== 'string' || request.body.length === 0 || request.body.length > 1_000_000) {
      response.status(400).json({ message: 'Upload an SDMS CSV file no larger than 1 MB.' })
      return
    }
    const teacher = await SchoolUser.findOne({
      _id: request.schoolUser!.id,
      role: { $in: ['teacher', 'dos_teacher'] },
      active: true,
      teacherGroupApproved: true,
    }).select('assignedCourses')
    if (!teacher) {
      response.status(403).json({ message: 'Only approved Teachers group members can upload marks.' })
      return
    }
    let parsed: ReturnType<typeof parseMarksCsv>
    try {
      parsed = parseMarksCsv(request.body)
    } catch (error) {
      response.status(400).json({ message: error instanceof Error ? error.message : 'The SDMS CSV could not be parsed.' })
      return
    }
    if (parsed.marks.length + parsed.invalidRows.length > 5000) {
      response.status(413).json({ message: 'A single import can contain at most 5,000 marks rows.' })
      return
    }

    const allowedRows = parsed.marks.filter((mark) =>
      teacher.assignedCourses.some((course) => subjectMatches(course, mark.subjectName)),
    )
    const invalidRows = [
      ...parsed.invalidRows,
      ...parsed.marks.filter((mark) => !allowedRows.includes(mark)).map((mark) => ({
        row: mark.rowNumber,
        reason: `Subject "${mark.subjectName}" is not assigned to your teacher account.`,
      })),
    ]
    const studentNumbers = [...new Set(allowedRows.map((mark) => mark.studentNumber))]
    const students = await Student.find({ sdmsCode: { $in: studentNumbers } }).select('_id sdmsCode').lean()
    const studentsByNumber = new Map(students.map((student) => [student.sdmsCode, student]))
    const unmatchedRows: Array<{ row: number; studentNumber: string; reason: string }> = []
    const operations = allowedRows.flatMap((mark) => {
      const student = studentsByNumber.get(mark.studentNumber)
      if (!student) {
        unmatchedRows.push({
          row: mark.rowNumber,
          studentNumber: mark.studentNumber,
          reason: 'No registered student with this SDMS number was found.',
        })
        return []
      }
      const { rowNumber: _rowNumber, ...values } = mark
      return [{
        updateOne: {
          filter: {
            studentNumber: mark.studentNumber,
            subjectCode: mark.subjectCode,
            assessmentType: mark.assessmentType,
            assessmentName: mark.assessmentName,
            term: mark.term,
            academicYear: mark.academicYear,
          },
          update: {
            $set: {
              ...values,
              studentId: student._id,
              importedBy: new mongoose.Types.ObjectId(request.schoolUser!.id),
              importedAt: new Date(),
            },
          },
          upsert: true,
        },
      }]
    })
    const result = operations.length ? await StudentMark.bulkWrite(operations, { ordered: true }) : null
    response.json({
      imported: result?.upsertedCount ?? 0,
      updated: result?.matchedCount ?? 0,
      unmatched: unmatchedRows.length,
      invalid: invalidRows.length,
      unmatchedRows,
      invalidRows,
    })
  },
)

app.patch(
  '/api/teacher/profile',
  requireAuthentication,
  requireRole('teacher', 'dos_teacher'),
  async (request, response) => {
    if (!isRecord(request.body)) {
      response.status(400).json({ message: 'Enter your name and studies or teaching qualification.' })
      return
    }
    const name = textField(request.body, 'name', 100)
    const studies = textField(request.body, 'studies', 500)
    if (!name || !studies) {
      response.status(400).json({ message: 'Enter your name (up to 100 characters) and studies or teaching qualification (up to 500 characters).' })
      return
    }
    const teacher = await SchoolUser.findOne({ _id: request.schoolUser!.id, role: { $in: ['teacher', 'dos_teacher'] } })
    if (!teacher) {
      response.status(404).json({ message: 'Teacher account not found.' })
      return
    }
    if (teacher.teacherStudies !== studies) {
      teacher.teacherStudies = studies
      teacher.teacherGroupApproved = false
      teacher.assignedCourses = []
    }
    teacher.teacherName = name
    await teacher.save()
    response.json({
      profile: {
        name: teacher.teacherName,
        studies: teacher.teacherStudies,
        approved: teacher.teacherGroupApproved,
        assignedCourses: teacher.assignedCourses,
      },
      message: teacher.teacherGroupApproved
        ? 'Studies updated.'
        : 'Studies submitted. An administrator must approve your Teachers group membership.',
    })
  },
)

app.get(
  '/api/dos/dashboard',
  requireAuthentication,
  requireRole('dos', 'dos_teacher', 'administrator'),
  async (request, response) => {
    const userId = request.schoolUser!.id
    const [states, students, admissions, teacherAccounts, contactQuestions] = await Promise.all([
      TaskState.find({ userId }).select('taskKey completedAt history updatedAt').lean(),
      Student.find().sort({ name: 1 }).lean(),
      AdmissionInquiry.find().sort({ createdAt: -1 }).lean(),
      SchoolUser.find({ role: { $in: ['teacher', 'dos_teacher'] }, active: true })
        .select('email role teacherStudies teacherGroupApproved assignedCourses').sort({ email: 1 }).lean(),
      ContactMessage.find({ dismissedAt: null }).sort({ createdAt: -1 }).lean(),
    ])
    const completed = new Map(states.map((state) => [state.taskKey, state.completedAt]))
    const taskNames = new Map(taskDefinitions.map((task) => [task.key, task.title]))
    const activity = states.flatMap((state) => state.history.map((item, index) => ({
      id: `${String(state._id)}-${index}`,
      text: `${taskNames.get(state.taskKey) ?? 'Academic task'} ${item.completed ? 'marked complete' : 'reopened'}`,
      at: item.at,
    }))).sort((first, second) => second.at.getTime() - first.at.getTime()).slice(0, 8)

    response.json({
      schoolName,
      academicYear: process.env.ACADEMIC_YEAR?.trim() || null,
      tasks: taskDefinitions.map((task) => ({
        ...task,
        completedAt: completed.get(task.key) ?? null,
      })),
      activity,
      students: students.map((student) => ({
        id: String(student._id),
        name: student.name,
        grade: student.grade,
        guardianName: student.guardianName,
        guardianPhone: student.guardianPhone,
        sdmsCode: student.sdmsCode ?? '',
        active: student.active,
      })),
      admissions: admissions.map((inquiry) => ({
        id: String(inquiry._id),
        studentName: inquiry.studentName,
        grade: inquiry.grade,
        guardianName: inquiry.guardianName,
        email: inquiry.email,
        phone: inquiry.phone,
        message: inquiry.message,
        status: inquiry.status,
        createdAt: inquiry.createdAt,
      })),
      teachers: teacherAccounts.filter((teacher) => teacher.teacherGroupApproved).map((teacher) => ({
        id: String(teacher._id),
        email: teacher.email,
        role: teacher.role,
        studies: teacher.teacherStudies ?? '',
        assignedCourses: teacher.assignedCourses ?? [],
      })),
      pendingTeachers: teacherAccounts.filter((teacher) => !teacher.teacherGroupApproved && Boolean(teacher.teacherStudies)).map((teacher) => ({
        id: String(teacher._id),
        email: teacher.email,
        role: teacher.role,
        studies: teacher.teacherStudies ?? '',
      })),
      contactQuestions: contactQuestions.map((question) => ({
        id: String(question._id),
        name: question.name,
        email: question.email,
        subject: question.subject,
        message: question.message,
        createdAt: question.createdAt,
      })),
    })
  },
)

app.get(
  '/api/dos/marks',
  requireAuthentication,
  requireRole('dos', 'dos_teacher', 'administrator'),
  async (request, response) => {
    const academicYear = typeof request.query.academicYear === 'string' ? request.query.academicYear.trim() : ''
    const term = typeof request.query.term === 'string' ? request.query.term.trim() : ''
    if (!academicYear || academicYear.length > 20 || !term || term.length > 30) {
      response.status(400).json({ message: 'Choose an academic year and term to view imported marks.' })
      return
    }
    const marks = await StudentMark.find({ academicYear, term })
      .sort({ classGrade: 1, studentName: 1, subjectName: 1, assessmentName: 1 })
      .limit(10000)
      .lean()
    response.json({
      marks: marks.map((mark) => ({
        id: String(mark._id),
        studentId: String(mark.studentId),
        studentNumber: mark.studentNumber,
        studentName: mark.studentName,
        classGrade: mark.classGrade,
        subjectCode: mark.subjectCode,
        subjectName: mark.subjectName,
        assessmentType: mark.assessmentType,
        assessmentName: mark.assessmentName,
        marksObtained: mark.marksObtained,
        maxMarks: mark.maxMarks,
        calculatedGrade: mark.calculatedGrade,
        gradePoints: mark.gradePoints,
        term: mark.term,
        academicYear: mark.academicYear,
        remarks: mark.remarks,
      })),
      truncated: marks.length === 10000,
    })
  },
)

app.get(
  '/api/dos/timetable',
  requireAuthentication,
  requireRole('dos', 'dos_teacher', 'administrator'),
  async (request, response) => {
    const academicYear = typeof request.query.academicYear === 'string'
      ? request.query.academicYear.trim()
      : process.env.ACADEMIC_YEAR?.trim() || ''
    if (!academicYear || academicYear.length > 20) {
      response.status(400).json({ message: 'Choose a valid academic year to view or configure a timetable.' })
      return
    }
    const [assignments, timetable] = await Promise.all([
      TeachingAssignment.find({ academicYear }).sort({ grade: 1, subject: 1 }).lean(),
      ClassTimetable.findOne({ academicYear }).lean(),
    ])
    const teacherIds = [...new Set(assignments.map((assignment) => String(assignment.teacherId)))]
    const teachers = await SchoolUser.find({ _id: { $in: teacherIds } }).select('email').lean()
    const emails = new Map(teachers.map((teacher) => [String(teacher._id), teacher.email]))
    response.json({
      academicYear,
      assignments: assignments.map((assignment) => ({
        id: String(assignment._id),
        teacherId: String(assignment.teacherId),
        teacherEmail: emails.get(String(assignment.teacherId)) ?? '',
        grade: assignment.grade,
        subject: assignment.subject,
        periodsPerWeek: assignment.periodsPerWeek,
      })),
      timetable: timetable?.slots.map((slot) => ({
        day: slot.day,
        period: slot.period,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        grade: slot.grade,
        subject: slot.subject,
        teacherId: String(slot.teacherId),
        teacherEmail: slot.teacherEmail,
      })) ?? [],
      generatedAt: timetable?.generatedAt ?? null,
    })
  },
)

app.put(
  '/api/dos/timetable/assignments',
  requireAuthentication,
  requireRole('dos', 'dos_teacher', 'administrator'),
  async (request, response) => {
    if (
      !isRecord(request.body) ||
      typeof request.body.academicYear !== 'string' ||
      request.body.academicYear.trim().length === 0 ||
      request.body.academicYear.trim().length > 20 ||
      !Array.isArray(request.body.assignments) ||
      request.body.assignments.length > 250
    ) {
      response.status(400).json({ message: 'Enter an academic year and no more than 250 teaching assignments.' })
      return
    }
    const academicYear = request.body.academicYear.trim()
    const rawAssignments = request.body.assignments
    const normalized = rawAssignments.map((item) => {
      if (!isRecord(item)) return null
      const periodsPerWeek = numberField(item, 'periodsPerWeek', 1, 40)
      const grade = textField(item, 'grade', 30)
      const subject = textField(item, 'subject', 100)
      const teacherId = textField(item, 'teacherId', 50)
      if (!periodsPerWeek || !grade || !subject || !teacherId || !mongoose.isValidObjectId(teacherId) || !isSchoolGrade(grade) || !teacherCourses.includes(subject)) return null
      return { teacherId, grade, subject, periodsPerWeek }
    })
    if (normalized.some((item) => item === null)) {
      response.status(400).json({ message: 'Each assignment must have a valid approved teacher, grade, subject, and weekly period count (1–40).' })
      return
    }
    const assignments = normalized.filter((item): item is NonNullable<typeof item> => item !== null)
    const keys = assignments.map((item) => `${item.teacherId}:${item.grade}:${item.subject}`)
    if (new Set(keys).size !== keys.length) {
      response.status(400).json({ message: 'A teacher, grade, and subject combination can only be assigned once per academic year.' })
      return
    }
    const teacherIds = [...new Set(assignments.map((item) => item.teacherId))]
    const teachers = await SchoolUser.find({
      _id: { $in: teacherIds },
      role: { $in: ['teacher', 'dos_teacher'] },
      active: true,
      teacherGroupApproved: true,
    }).select('email assignedCourses').lean()
    const teachersById = new Map(teachers.map((teacher) => [String(teacher._id), teacher]))
    const invalidAssignment = assignments.find((assignment) => {
      const teacher = teachersById.get(assignment.teacherId)
      return !teacher || !teacher.assignedCourses.some((course) => subjectMatches(course, assignment.subject))
    })
    if (invalidAssignment) {
      response.status(400).json({ message: 'Every assignment must use a subject approved for that active teacher.' })
      return
    }
    const gradeLoads = new Map<string, number>()
    const teacherLoads = new Map<string, number>()
    for (const assignment of assignments) {
      gradeLoads.set(assignment.grade, (gradeLoads.get(assignment.grade) ?? 0) + assignment.periodsPerWeek)
      teacherLoads.set(assignment.teacherId, (teacherLoads.get(assignment.teacherId) ?? 0) + assignment.periodsPerWeek)
    }
    if ([...gradeLoads.values(), ...teacherLoads.values()].some((load) => load > 40)) {
      response.status(400).json({ message: 'A grade or teacher cannot be assigned more than 40 weekly periods.' })
      return
    }

    const previous = await TeachingAssignment.find({ academicYear }).select('_id teacherId grade subject').lean()
    const keepKeys = new Set(keys)
    const staleIds = previous
      .filter((item) => !keepKeys.has(`${String(item.teacherId)}:${item.grade}:${item.subject}`))
      .map((item) => item._id)
    if (assignments.length) {
      await TeachingAssignment.bulkWrite(assignments.map((assignment) => ({
        updateOne: {
          filter: { academicYear, teacherId: new mongoose.Types.ObjectId(assignment.teacherId), grade: assignment.grade, subject: assignment.subject },
          update: { $set: { ...assignment, teacherId: new mongoose.Types.ObjectId(assignment.teacherId), academicYear } },
          upsert: true,
        },
      })), { ordered: true })
    }
    if (staleIds.length) await TeachingAssignment.deleteMany({ _id: { $in: staleIds } })
    await ClassTimetable.deleteOne({ academicYear })
    const saved = await TeachingAssignment.find({ academicYear }).sort({ grade: 1, subject: 1 }).lean()
    response.json({
      message: 'Weekly teaching assignments saved.',
      assignments: saved.map((assignment) => ({
        id: String(assignment._id),
        teacherId: String(assignment.teacherId),
        teacherEmail: teachersById.get(String(assignment.teacherId))?.email ?? '',
        grade: assignment.grade,
        subject: assignment.subject,
        periodsPerWeek: assignment.periodsPerWeek,
      })),
    })
  },
)

app.post(
  '/api/dos/timetable/generate',
  requireAuthentication,
  requireRole('dos', 'dos_teacher', 'administrator'),
  async (request, response) => {
    if (!isRecord(request.body)) {
      response.status(400).json({ message: 'Choose an academic year to generate a timetable.' })
      return
    }
    const academicYear = textField(request.body, 'academicYear', 20)
    if (!academicYear) {
      response.status(400).json({ message: 'Choose a valid academic year to generate a timetable.' })
      return
    }
    const assignments = await TeachingAssignment.find({ academicYear }).lean()
    if (!assignments.length) {
      response.status(400).json({ message: 'Add and save weekly teaching assignments before generating a timetable.' })
      return
    }
    const teachers = await SchoolUser.find({
      _id: { $in: [...new Set(assignments.map((assignment) => assignment.teacherId))] },
      role: { $in: ['teacher', 'dos_teacher'] },
      active: true,
      teacherGroupApproved: true,
    }).select('email assignedCourses').lean()
    const teachersById = new Map(teachers.map((teacher) => [String(teacher._id), teacher]))
    const invalidAssignment = assignments.find((assignment) => {
      const teacher = teachersById.get(String(assignment.teacherId))
      return !teacher || !teacher.assignedCourses.some((course) => subjectMatches(course, assignment.subject))
    })
    if (invalidAssignment) {
      response.status(409).json({
        message: `The assignment for ${invalidAssignment.subject} in ${invalidAssignment.grade} is no longer approved for its teacher. Update assignments before generating.`,
      })
      return
    }
    const scheduleAssignments: ScheduleAssignment[] = []
    for (const assignment of assignments) {
      const teacher = teachersById.get(String(assignment.teacherId))
      if (!teacher) {
        response.status(409).json({ message: 'A timetable assignment references a teacher who is no longer active or approved.' })
        return
      }
      scheduleAssignments.push({
        id: String(assignment._id),
        teacherId: String(assignment.teacherId),
        teacherEmail: teacher.email,
        grade: assignment.grade,
        subject: assignment.subject,
        periodsPerWeek: assignment.periodsPerWeek,
      })
    }
    let slots
    try {
      slots = generateTimetable(scheduleAssignments)
    } catch (error) {
      response.status(400).json({ message: error instanceof Error ? error.message : 'A clash-free timetable could not be generated.' })
      return
    }
    const generatedAt = new Date()
    const timetable = await ClassTimetable.findOneAndUpdate(
      { academicYear },
      {
        $set: {
          academicYear,
          generatedBy: request.schoolUser!.id,
          generatedAt,
          slots: slots.map((slot) => ({ ...slot, teacherId: new mongoose.Types.ObjectId(slot.teacherId) })),
        },
      },
      { upsert: true, new: true, runValidators: true },
    ).lean()
    response.json({
      message: 'Clash-free timetable generated.',
      generatedAt: timetable.generatedAt,
      timetable: timetable.slots.map((slot) => ({
        day: slot.day,
        period: slot.period,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        grade: slot.grade,
        subject: slot.subject,
        teacherId: String(slot.teacherId),
        teacherEmail: slot.teacherEmail,
      })),
    })
  },
)

app.patch(
  '/api/dos/teachers/:teacherId/approval',
  requireAuthentication,
  requireRole('dos', 'dos_teacher', 'administrator'),
  async (request, response) => {
    const approvedCourses = isRecord(request.body) && Array.isArray(request.body.courses)
      ? request.body.courses.filter((course): course is string => typeof course === 'string' && teacherCourses.includes(course))
      : []
    if (
      !mongoose.isValidObjectId(request.params.teacherId) ||
      !isRecord(request.body) ||
      typeof request.body.approved !== 'boolean' ||
      request.body.approved && (
        !Array.isArray(request.body.courses) ||
        approvedCourses.length === 0 ||
        approvedCourses.length !== request.body.courses.length ||
        new Set(approvedCourses).size !== approvedCourses.length
      )
    ) {
      response.status(400).json({ message: 'Choose a valid teacher and approval status, and select at least one valid course when approving.' })
      return
    }
    const teacher = await SchoolUser.findOne({
      _id: request.params.teacherId,
      role: { $in: ['teacher', 'dos_teacher'] },
      active: true,
    })
    if (!teacher) {
      response.status(404).json({ message: 'Teacher account not found.' })
      return
    }
    if (request.body.approved && !teacher.teacherStudies) {
      response.status(409).json({ message: 'The teacher must submit their studies before approval.' })
      return
    }
    if (!request.body.approved && request.schoolUser!.role !== 'administrator') {
      response.status(403).json({ message: 'Only an administrator can remove a teacher from the Teachers group.' })
      return
    }
    teacher.teacherGroupApproved = request.body.approved
    teacher.assignedCourses = teacher.teacherGroupApproved
      ? approvedCourses
      : []
    await teacher.save()
    response.json({
      message: teacher.teacherGroupApproved
        ? 'Teacher approved and preferred courses assigned.'
        : 'Teacher removed from the Teachers group.',
    })
  },
)

app.put(
  '/api/dos/teachers/:teacherId/courses',
  requireAuthentication,
  requireRole('dos', 'dos_teacher', 'administrator'),
  async (request, response) => {
    if (
      !mongoose.isValidObjectId(request.params.teacherId) ||
      !isRecord(request.body) ||
      !Array.isArray(request.body.courses) ||
      !request.body.courses.every((course): course is string => typeof course === 'string' && teacherCourses.includes(course)) ||
      new Set(request.body.courses).size !== request.body.courses.length
    ) {
      response.status(400).json({ message: 'Choose valid, unique courses for this teacher.' })
      return
    }
    const teacher = await SchoolUser.findOneAndUpdate(
      {
        _id: request.params.teacherId,
        role: { $in: ['teacher', 'dos_teacher'] },
        active: true,
        teacherGroupApproved: true,
      },
      { $set: { assignedCourses: request.body.courses } },
      { new: true, runValidators: true },
    )
    if (!teacher) {
      response.status(404).json({ message: 'Approved teacher account not found.' })
      return
    }
    response.json({ message: 'Teacher courses updated.', assignedCourses: teacher.assignedCourses })
  },
)

app.post(
  '/api/dos/admissions/:inquiryId/register',
  requireAuthentication,
  requireRole('dos', 'dos_teacher', 'administrator'),
  async (request, response) => {
    if (!mongoose.isValidObjectId(request.params.inquiryId) || !isRecord(request.body)) {
      response.status(400).json({ message: 'Choose a valid admission inquiry and enter its SDMS code.' })
      return
    }
    const sdmsCode = textField(request.body, 'sdmsCode', 50)
    if (!sdmsCode) {
      response.status(400).json({ message: 'Enter the official SDMS code issued for this student.' })
      return
    }
    const inquiry = await AdmissionInquiry.findById(request.params.inquiryId).lean()
    if (!inquiry) {
      response.status(404).json({ message: 'Admission inquiry not found.' })
      return
    }
    if (inquiry.status === 'registered' || inquiry.studentId) {
      response.status(409).json({ message: 'This admission inquiry is already linked to a registered student.' })
      return
    }

    const student = await Student.create({
      name: inquiry.studentName,
      grade: inquiry.grade,
      guardianName: inquiry.guardianName,
      guardianPhone: inquiry.phone,
      sdmsCode,
      admissionInquiryId: inquiry._id,
    })
    try {
      const linkedInquiry = await AdmissionInquiry.findOneAndUpdate(
        { _id: inquiry._id, status: { $ne: 'registered' }, studentId: null },
        { $set: { status: 'registered', studentId: student._id } },
        { new: true },
      )
      if (!linkedInquiry) {
        await Student.deleteOne({ _id: student._id })
        response.status(409).json({ message: 'This admission inquiry was registered by another staff member.' })
        return
      }
    } catch (error) {
      await Student.deleteOne({ _id: student._id })
      throw error
    }

    const emailConfirmation = await sendRegistrationConfirmation(
      inquiry.email,
      `Student registration confirmed: ${student.name}`,
      `Hello ${inquiry.guardianName},\n\n${student.name} has been registered at ${schoolName} in ${student.grade}.\n\nIf you have questions, reply to this email or contact the school.\n\n${schoolName}`,
    )
    response.status(201).json({
      student: { id: String(student._id), name: student.name, sdmsCode: student.sdmsCode },
      emailConfirmation,
    })
  },
)

app.put(
  '/api/dos/students/:studentId',
  requireAuthentication,
  requireRole('dos', 'dos_teacher', 'administrator'),
  async (request, response) => {
    if (!mongoose.isValidObjectId(request.params.studentId) || !isRecord(request.body)) {
      response.status(400).json({ message: 'Choose a valid student record.' })
      return
    }
    const name = textField(request.body, 'name', 100)
    const grade = textField(request.body, 'grade', 30)
    const sdmsCode = textField(request.body, 'sdmsCode', 50)
    const guardianName = optionalTextField(request.body, 'guardianName', 100)
    const guardianPhone = optionalTextField(request.body, 'guardianPhone', 30)
    const active = request.body.active
    if (
      !name || !grade || !isSchoolGrade(grade) || !sdmsCode ||
      guardianName === null || guardianPhone === null || typeof active !== 'boolean'
    ) {
      response.status(400).json({ message: 'Enter a valid name, grade, SDMS code, guardian contact, and status.' })
      return
    }
    const student = await Student.findByIdAndUpdate(
      request.params.studentId,
      { $set: { name, grade, sdmsCode, guardianName, guardianPhone, active } },
      { new: true, runValidators: true },
    )
    if (!student) {
      response.status(404).json({ message: 'Student record not found.' })
      return
    }
    response.json({ message: 'Student record updated.' })
  },
)

app.delete(
  '/api/dos/students/:studentId',
  requireAuthentication,
  requireRole('dos', 'dos_teacher', 'administrator'),
  async (request, response) => {
    if (!mongoose.isValidObjectId(request.params.studentId)) {
      response.status(400).json({ message: 'Choose a valid student record.' })
      return
    }
    const studentId = request.params.studentId
    const [hasMarks, hasFees] = await Promise.all([
      StudentMark.exists({ studentId }),
      StudentFee.exists({ studentId }),
    ])
    if (hasMarks || hasFees) {
      response.status(409).json({ message: 'This student has marks or fee records and cannot be deleted. Update the student status to inactive instead.' })
      return
    }
    const student = await Student.findByIdAndDelete(studentId)
    if (!student) {
      response.status(404).json({ message: 'Student record not found.' })
      return
    }
    await AdmissionInquiry.updateOne(
      { studentId: student._id },
      { $set: { studentId: null, status: 'closed' } },
    )
    response.status(204).end()
  },
)

app.patch(
  '/api/dos/tasks/:taskKey',
  requireAuthentication,
  requireRole('dos', 'dos_teacher', 'administrator'),
  async (request, response) => {
    const task = taskDefinitions.find((item) => item.key === request.params.taskKey)
    if (!task || !isRecord(request.body) || typeof request.body.completed !== 'boolean') {
      response.status(400).json({ message: 'Select a valid task state.' })
      return
    }

    const userId = request.schoolUser!.id
    const completed = request.body.completed
    const now = new Date()
    await TaskState.findOneAndUpdate(
      { userId, taskKey: task.key },
      {
        $set: { completedAt: completed ? now : null },
        $push: { history: { $each: [{ completed, at: now }], $slice: -20 } },
      },
      { upsert: true, new: true },
    )
    response.json({ message: 'Task checklist updated.' })
  },
)

app.get(
  '/api/accountant/dashboard',
  requireAuthentication,
  requireRole('accountant', 'administrator'),
  async (_request, response) => {
    const [students, fees, feeSchedules, stockItems, announcements] = await Promise.all([
      Student.find().sort({ name: 1 }).lean(),
      StudentFee.find().sort({ academicYear: -1, term: 1 }).lean(),
      FeeSchedule.find().sort({ academicYear: -1, grade: 1, term: 1 }).lean(),
      StockItem.find().sort({ name: 1 }).lean(),
      FeeAnnouncement.find().sort({ createdAt: -1 }).lean(),
    ])

    response.json({
      students: students.map((student) => ({
        id: String(student._id),
        name: student.name,
        grade: student.grade,
        guardianName: student.guardianName,
        guardianPhone: student.guardianPhone,
        active: student.active,
      })),
      fees: fees.map((fee) => {
        const paidTotal = fee.payments.reduce((total, payment) => total + payment.amount, 0)
        return {
          id: String(fee._id),
          studentId: String(fee.studentId),
          academicYear: fee.academicYear,
          term: fee.term,
          amountDue: fee.amountDue,
          paidTotal,
          balance: fee.amountDue - paidTotal,
          status: paidTotal >= fee.amountDue ? 'paid' : paidTotal > 0 ? 'partial' : 'unpaid',
          payments: fee.payments.map((payment) => ({
            id: String(payment._id),
            amount: payment.amount,
            paidAt: payment.paidAt,
            reference: payment.reference,
          })),
        }
      }),
      feeSchedules: feeSchedules.map((schedule) => ({
        id: String(schedule._id),
        academicYear: schedule.academicYear,
        grade: schedule.grade,
        term: schedule.term,
        amountDue: schedule.amountDue,
      })),
      stockItems: stockItems.map((item) => ({
        id: String(item._id),
        name: item.name,
        category: item.category,
        unit: item.unit,
        quantity: item.quantity,
        lowStockThreshold: item.lowStockThreshold,
        movements: item.movements.map((movement) => ({
          id: String(movement._id),
          type: movement.type,
          quantity: movement.quantity,
          note: movement.note,
          at: movement.at,
        })),
      })),
      announcements: announcements.map((announcement) => ({
        id: String(announcement._id),
        title: announcement.title,
        body: announcement.body,
        published: announcement.published,
        createdAt: announcement.createdAt,
      })),
    })
  },
)

app.get(
  '/api/accountant/reports/monthly',
  requireAuthentication,
  requireRole('accountant', 'administrator'),
  async (request, response) => {
    const month = request.query.month
    if (
      typeof month !== 'string' ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
      Number(month.slice(0, 4)) < 2000 ||
      Number(month.slice(0, 4)) > 2100
    ) {
      response.status(400).json({ message: 'Choose a valid report month.' })
      return
    }

    const [year, monthNumber] = month.split('-').map(Number)
    const start = new Date(Date.UTC(year, monthNumber - 1, 1))
    const end = new Date(Date.UTC(year, monthNumber, 1))
    const fees = await StudentFee.find({
      'payments.paidAt': { $gte: start, $lt: end },
    }).lean()
    const studentIds = [...new Set(fees.map((fee) => String(fee.studentId)))]
    const students = await Student.find({ _id: { $in: studentIds } }).select('name grade').lean()
    const studentsById = new Map(students.map((student) => [String(student._id), student]))
    const payments = fees.flatMap((fee) => {
      const student = studentsById.get(String(fee.studentId))
      return fee.payments
        .filter((payment) => payment.paidAt >= start && payment.paidAt < end)
        .map((payment) => ({
          id: String(payment._id),
          studentName: student?.name ?? 'Student record',
          grade: student?.grade ?? '',
          academicYear: fee.academicYear,
          term: fee.term,
          amount: payment.amount,
          paidAt: payment.paidAt,
          reference: payment.reference,
        }))
    }).sort((first, second) => first.paidAt.getTime() - second.paidAt.getTime())

    response.json({
      month,
      totalCollected: payments.reduce((total, payment) => total + payment.amount, 0),
      paymentCount: payments.length,
      payments,
    })
  },
)

app.post(
  '/api/accountant/students',
  requireAuthentication,
  requireRole('accountant', 'administrator'),
  async (request, response) => {
    if (!isRecord(request.body)) {
      response.status(400).json({ message: 'Enter the student’s name and grade.' })
      return
    }
    const name = textField(request.body, 'name', 100)
    const grade = textField(request.body, 'grade', 30)
    const guardianName = optionalTextField(request.body, 'guardianName', 100)
    const guardianPhone = optionalTextField(request.body, 'guardianPhone', 30)
    if (!name || !grade || !isSchoolGrade(grade) || guardianName === null || guardianPhone === null) {
      response.status(400).json({ message: 'Enter a valid student name, grade, and guardian contact.' })
      return
    }
    const student = await Student.create({ name, grade, guardianName, guardianPhone })
    response.status(201).json({ student: { id: String(student._id), name: student.name, grade: student.grade } })
  },
)

app.patch(
  '/api/accountant/students/:studentId',
  requireAuthentication,
  requireRole('accountant', 'administrator'),
  async (request, response) => {
    if (!mongoose.isValidObjectId(request.params.studentId) || !isRecord(request.body) || typeof request.body.active !== 'boolean') {
      response.status(400).json({ message: 'Choose a valid student status.' })
      return
    }
    const student = await Student.findByIdAndUpdate(
      request.params.studentId,
      { $set: { active: request.body.active } },
      { new: true, runValidators: true },
    )
    if (!student) {
      response.status(404).json({ message: 'Student record not found.' })
      return
    }
    response.json({ student: { id: String(student._id), active: student.active } })
  },
)

app.post(
  '/api/accountant/fees',
  requireAuthentication,
  requireRole('accountant', 'administrator'),
  async (request, response) => {
    if (!isRecord(request.body)) {
      response.status(400).json({ message: 'Enter the student, academic year, term, and fee amount.' })
      return
    }
    const studentId = textField(request.body, 'studentId', 30)
    const academicYear = textField(request.body, 'academicYear', 20)
    const term = textField(request.body, 'term', 20)
    const amountDue = numberField(request.body, 'amountDue', 1, 100_000_000)
    if (
      !studentId || !mongoose.isValidObjectId(studentId) ||
      !academicYear || !term || !terms.includes(term) || amountDue === null
    ) {
      response.status(400).json({ message: 'Enter valid fee details; the amount must be a whole RWF amount.' })
      return
    }
    if (!await Student.exists({ _id: studentId, active: true })) {
      response.status(404).json({ message: 'Active student record not found.' })
      return
    }
    const fee = await StudentFee.create({ studentId, academicYear, term, amountDue })
    response.status(201).json({ fee: { id: String(fee._id) } })
  },
)

app.post(
  '/api/accountant/fee-schedules',
  requireAuthentication,
  requireRole('accountant', 'administrator'),
  async (request, response) => {
    if (!isRecord(request.body)) {
      response.status(400).json({ message: 'Enter the academic year, grade, term, and fee amount.' })
      return
    }
    const academicYear = textField(request.body, 'academicYear', 20)
    const grade = textField(request.body, 'grade', 30)
    const term = textField(request.body, 'term', 20)
    const amountDue = numberField(request.body, 'amountDue', 1, 100_000_000)
    if (!academicYear || !grade || !isSchoolGrade(grade) || !term || !terms.includes(term) || amountDue === null) {
      response.status(400).json({ message: 'Enter a valid academic year, grade, term, and whole RWF fee amount.' })
      return
    }
    const schedule = await FeeSchedule.findOneAndUpdate(
      { academicYear, grade, term },
      { $set: { amountDue } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    )
    response.json({
      feeSchedule: {
        id: String(schedule._id),
        academicYear: schedule.academicYear,
        grade: schedule.grade,
        term: schedule.term,
        amountDue: schedule.amountDue,
      },
    })
  },
)

app.post(
  '/api/accountant/fee-schedules/:scheduleId/apply',
  requireAuthentication,
  requireRole('accountant', 'administrator'),
  async (request, response) => {
    if (!mongoose.isValidObjectId(request.params.scheduleId)) {
      response.status(400).json({ message: 'Choose a valid grade fee schedule.' })
      return
    }
    const schedule = await FeeSchedule.findById(request.params.scheduleId).lean()
    if (!schedule) {
      response.status(404).json({ message: 'Grade fee schedule not found.' })
      return
    }
    const students = await Student.find({ grade: schedule.grade, active: true }).select('_id').lean()
    if (students.length === 0) {
      response.json({ created: 0, message: `There are no active students in ${schedule.grade}.` })
      return
    }
    const result = await StudentFee.bulkWrite(
      students.map((student) => ({
        updateOne: {
          filter: {
            studentId: student._id,
            academicYear: schedule.academicYear,
            term: schedule.term,
          },
          update: { $setOnInsert: { amountDue: schedule.amountDue } },
          upsert: true,
        },
      })),
      { ordered: false },
    )
    response.json({
      created: result.upsertedCount,
      unchanged: result.matchedCount,
      message: `${result.upsertedCount} fee balance${result.upsertedCount === 1 ? '' : 's'} created for ${schedule.grade}; ${result.matchedCount} existing balance${result.matchedCount === 1 ? ' was' : 's were'} left unchanged.`,
    })
  },
)

app.post(
  '/api/accountant/fees/:feeId/payments',
  requireAuthentication,
  requireRole('accountant', 'administrator'),
  async (request, response) => {
    if (!mongoose.isValidObjectId(request.params.feeId) || !isRecord(request.body)) {
      response.status(400).json({ message: 'Enter a valid fee record and payment.' })
      return
    }
    const amount = numberField(request.body, 'amount', 1, 100_000_000)
    const reference = optionalTextField(request.body, 'reference', 100)
    if (amount === null || reference === null) {
      response.status(400).json({ message: 'Enter a whole RWF payment amount and a valid optional reference.' })
      return
    }
    const fee = await StudentFee.findOneAndUpdate(
      {
        _id: request.params.feeId,
        $expr: {
          $lte: [{ $add: [{ $sum: '$payments.amount' }, amount] }, '$amountDue'],
        },
      },
      { $push: { payments: { amount, reference, paidAt: new Date() } } },
      { new: true, runValidators: true },
    )
    if (!fee) {
      if (!await StudentFee.exists({ _id: request.params.feeId })) {
        response.status(404).json({ message: 'Fee record not found.' })
      } else {
        response.status(409).json({ message: 'The payment is greater than the outstanding balance.' })
      }
      return
    }
    response.status(201).json({ message: 'Payment recorded.' })
  },
)

app.post(
  '/api/accountant/stock',
  requireAuthentication,
  requireRole('accountant', 'administrator'),
  async (request, response) => {
    if (!isRecord(request.body)) {
      response.status(400).json({ message: 'Enter the stock item details.' })
      return
    }
    const name = textField(request.body, 'name', 100)
    const category = textField(request.body, 'category', 60)
    const unit = textField(request.body, 'unit', 30)
    const quantity = numberField(request.body, 'quantity', 0, 100_000_000)
    const lowStockThreshold = numberField(request.body, 'lowStockThreshold', 0, 100_000_000)
    if (!name || !category || !unit || quantity === null || lowStockThreshold === null) {
      response.status(400).json({ message: 'Enter valid item details and whole-number quantities.' })
      return
    }
    const item = await StockItem.create({
      name,
      category,
      unit,
      quantity,
      lowStockThreshold,
      movements: quantity > 0 ? [{ type: 'restock', quantity, note: 'Opening stock' }] : [],
    })
    response.status(201).json({ item: { id: String(item._id) } })
  },
)

app.post(
  '/api/accountant/stock/:itemId/movements',
  requireAuthentication,
  requireRole('accountant', 'administrator'),
  async (request, response) => {
    if (!mongoose.isValidObjectId(request.params.itemId) || !isRecord(request.body)) {
      response.status(400).json({ message: 'Enter a valid stock item and movement.' })
      return
    }
    const type = request.body.type
    const quantity = numberField(request.body, 'quantity', 1, 100_000_000)
    const note = optionalTextField(request.body, 'note', 150)
    if ((type !== 'restock' && type !== 'usage') || quantity === null || note === null) {
      response.status(400).json({ message: 'Enter a valid restock or usage quantity and optional note.' })
      return
    }
    const item = await StockItem.findOneAndUpdate(
      type === 'usage'
        ? { _id: request.params.itemId, quantity: { $gte: quantity } }
        : { _id: request.params.itemId },
      {
        $inc: { quantity: type === 'restock' ? quantity : -quantity },
        $push: { movements: { $each: [{ type, quantity, note, at: new Date() }], $slice: -100 } },
      },
      { new: true, runValidators: true },
    )
    if (!item) {
      if (!await StockItem.exists({ _id: request.params.itemId })) {
        response.status(404).json({ message: 'Stock item not found.' })
      } else {
        response.status(409).json({ message: 'There is not enough stock for that usage amount.' })
      }
      return
    }
    response.status(201).json({ message: 'Stock movement recorded.' })
  },
)

app.get(
  '/api/admin/users',
  requireAuthentication,
  requireRole('administrator'),
  async (_request, response) => {
    const users = await SchoolUser.find().sort({ createdAt: 1 }).lean()
    response.json({ users: users.map(publicUser) })
  },
)

app.post(
  '/api/admin/users',
  requireAuthentication,
  requireRole('administrator'),
  async (request, response) => {
    if (!isRecord(request.body)) {
      response.status(400).json({ message: 'Enter an email, password, and role.' })
      return
    }
    const email = textField(request.body, 'email', 254)?.toLowerCase()
    const password = request.body.password
    const role = request.body.role
    if (
      !email || !emailPattern.test(email) ||
      typeof password !== 'string' || password.length < 12 || password.length > 256 ||
      !isSchoolRole(role)
    ) {
      response.status(400).json({ message: 'Use a valid email, a password of at least 12 characters, and a listed role.' })
      return
    }
    if (await SchoolUser.exists({ email })) {
      response.status(409).json({ message: 'An account with this email already exists.' })
      return
    }

    const user = await SchoolUser.create({ email, passwordHash: await makePasswordHash(password), role })
    const emailConfirmation = await sendRegistrationConfirmation(
      email,
      `Your ${role} account is ready`,
      `Hello,\n\nAn account has been created for you on the ${schoolName} staff website with the role: ${role}.\n\nSign in at ${frontendOrigin}/sign-in. For your initial password, contact the administrator who created your account; passwords are never sent by email.\n\n${schoolName}`,
    )
    response.status(201).json({ user: publicUser(user), emailConfirmation })
  },
)

app.patch(
  '/api/admin/users/:userId',
  requireAuthentication,
  requireRole('administrator'),
  async (request, response) => {
    if (!isRecord(request.body)) {
      response.status(400).json({ message: 'Choose an account status or role.' })
      return
    }
    const update: { active?: boolean; role?: SchoolRole } = {}
    if (typeof request.body.active === 'boolean') update.active = request.body.active
    if (isSchoolRole(request.body.role)) update.role = request.body.role
    if (Object.keys(update).length === 0) {
      response.status(400).json({ message: 'Choose a valid account status or role.' })
      return
    }
    if (
      request.params.userId === request.schoolUser!.id &&
      (update.active === false || update.role !== undefined && update.role !== 'administrator')
    ) {
      response.status(400).json({ message: 'You cannot disable or demote your own administrator account.' })
      return
    }

    const target = await SchoolUser.findById(request.params.userId)
    if (!target) {
      response.status(404).json({ message: 'Staff account not found.' })
      return
    }
    const removesAdministrator = target.role === 'administrator' &&
      (update.active === false || update.role !== undefined && update.role !== 'administrator')
    if (removesAdministrator && await SchoolUser.countDocuments({ role: 'administrator', active: true }) <= 1) {
      response.status(409).json({ message: 'At least one active administrator must remain.' })
      return
    }
    if (update.active !== undefined && update.active !== target.active) target.authVersion += 1
    if (update.role !== undefined && update.role !== target.role) {
      const wasTeacher = target.role === 'teacher' || target.role === 'dos_teacher'
      const willBeTeacher = update.role === 'teacher' || update.role === 'dos_teacher'
      if (wasTeacher !== willBeTeacher) {
        target.teacherGroupApproved = false
        target.assignedCourses = []
      }
    }
    Object.assign(target, update)
    await target.save()
    response.json({ user: publicUser(target) })
  },
)

app.delete(
  '/api/admin/users/:userId',
  requireAuthentication,
  requireRole('administrator'),
  async (request, response) => {
    if (!mongoose.isValidObjectId(request.params.userId)) {
      response.status(400).json({ message: 'Select a valid staff account.' })
      return
    }

    const user = await SchoolUser.findOneAndDelete({ _id: request.params.userId, active: false })
    if (!user) {
      if (await SchoolUser.exists({ _id: request.params.userId })) {
        response.status(409).json({ message: 'Disable the staff account before deleting it.' })
      } else {
        response.status(404).json({ message: 'Staff account not found.' })
      }
      return
    }

    await Promise.all([
      SchoolSession.deleteMany({ userId: user._id }),
      PasswordRecovery.deleteMany({ userId: user._id }),
      TaskState.deleteMany({ userId: user._id }),
    ])
    response.status(204).end()
  },
)

const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  console.error('API request failed:', error)
  if (isRecord(error) && error.type === 'entity.too.large') {
    response.status(413).json({ message: 'The uploaded file exceeds the 1 MB limit.' })
    return
  }
  if (error instanceof mongoose.mongo.MongoServerError && error.code === 11000) {
    response.status(409).json({ message: 'A record with those details already exists.' })
    return
  }
  response.status(500).json({ message: 'The request could not be completed. Please try again later.' })
}
if (process.env.NODE_ENV === 'production' && process.env.VERCEL !== '1') {
  const frontendDirectory = resolve(process.cwd(), 'dist')
  app.use(express.static(frontendDirectory))
  app.use((request, response, next) => {
    if (request.method !== 'GET' || request.path === '/api' || request.path.startsWith('/api/')) {
      next()
      return
    }
    response.sendFile(resolve(frontendDirectory, 'index.html'), (error) => {
      if (error) next(error)
    })
  })
}
app.use(errorHandler)

async function start() {
  if (!mongoUri) throw new Error('MONGODB_URI is required. Copy .env.example to .env and configure MongoDB.')
  await connectToDatabase()
  app.listen(port, () => console.log(`${schoolName} API listening on port ${port}`))
}

if (process.env.VERCEL !== '1') {
  start().catch((error: unknown) => {
    console.error(`Could not start the ${schoolName} API:`, error)
    process.exitCode = 1
  })
}

export default app
