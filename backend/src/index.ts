import cors from '@fastify/cors'
import Fastify from 'fastify'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { Server as SocketIOServer } from 'socket.io'
import { createRateLimiter } from './rate-limit.js'

type MessageDTO = {
  id: string
  text: string
  username: string
  displayName: string
  createdAt: string
}

type GetMessagesQuery = {
  limit?: string
}

type PostMessageBody = {
  text?: string
  username?: string
  displayName?: string
}

const BACKEND_PORT = Number(process.env.BACKEND_PORT ?? 3000)
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173'
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX ?? 10)
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 10000)
const MESSAGE_MAX_LENGTH = 1000
const NAME_MAX_LENGTH = 64
const HISTORY_MAX_LIMIT = 200

const allowedOrigins = CORS_ORIGIN.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const prisma = new PrismaClient()
const rateLimiter = createRateLimiter(RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX)

const app = Fastify({
  logger: true,
  trustProxy: true,
})

await app.register(cors, {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
      return
    }
    callback(new Error('Origin not allowed'), false)
  },
})

const io = new SocketIOServer(app.server, {
  path: '/socket.io',
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
  },
})

function normalizeMessage(message: {
  id: string
  text: string
  username: string
  displayName: string | null
  createdAt: Date
}): MessageDTO {
  return {
    id: message.id,
    text: message.text,
    username: message.username,
    displayName: message.displayName ?? message.username,
    createdAt: message.createdAt.toISOString(),
  }
}

function getClientKey(ipAddress: string, username: string) {
  return `${ipAddress}:${username}`
}

function trimAndValidateText(rawText: unknown) {
  if (typeof rawText !== 'string') {
    return { ok: false, message: 'text must be a string' } as const
  }

  const text = rawText.trim()
  if (text.length === 0) {
    return { ok: false, message: 'text cannot be empty' } as const
  }
  if (text.length > MESSAGE_MAX_LENGTH) {
    return { ok: false, message: `text must be <= ${MESSAGE_MAX_LENGTH} characters` } as const
  }

  return { ok: true, value: text } as const
}

function trimAndValidateUsername(rawUsername: unknown) {
  if (typeof rawUsername !== 'string') {
    return { ok: false, message: 'username must be a string' } as const
  }

  const username = rawUsername.trim()
  if (username.length === 0) {
    return { ok: false, message: 'username cannot be empty' } as const
  }
  if (username.length > NAME_MAX_LENGTH) {
    return { ok: false, message: `username must be <= ${NAME_MAX_LENGTH} characters` } as const
  }

  return { ok: true, value: username } as const
}

function trimAndValidateDisplayName(rawDisplayName: unknown, fallbackUsername: string) {
  if (rawDisplayName === undefined || rawDisplayName === null) {
    return { ok: true, value: fallbackUsername } as const
  }

  if (typeof rawDisplayName !== 'string') {
    return { ok: false, message: 'displayName must be a string' } as const
  }

  const displayName = rawDisplayName.trim()
  if (displayName.length === 0) {
    return { ok: true, value: fallbackUsername } as const
  }

  if (displayName.length > NAME_MAX_LENGTH) {
    return { ok: false, message: `displayName must be <= ${NAME_MAX_LENGTH} characters` } as const
  }

  return { ok: true, value: displayName } as const
}

app.get('/health', async (_, reply) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    return reply.send({ status: 'ok', database: 'up' })
  } catch (error) {
    app.log.error(error, 'Healthcheck DB query failed')
    return reply.code(500).send({ status: 'error', database: 'down' })
  }
})

app.get<{ Querystring: GetMessagesQuery }>('/messages', async (request, reply) => {
  const rawLimit = Number.parseInt(request.query.limit ?? `${HISTORY_MAX_LIMIT}`, 10)
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(HISTORY_MAX_LIMIT, rawLimit))
    : HISTORY_MAX_LIMIT

  const rows = await prisma.message.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  const messages = rows.reverse().map(normalizeMessage)
  return reply.send({ messages })
})

app.post<{ Body: PostMessageBody }>('/messages', async (request, reply) => {
  const textResult = trimAndValidateText(request.body?.text)
  if (!textResult.ok) {
    return reply.code(400).send({ error: 'validation_error', message: textResult.message })
  }

  const usernameResult = trimAndValidateUsername(request.body?.username)
  if (!usernameResult.ok) {
    return reply.code(400).send({ error: 'validation_error', message: usernameResult.message })
  }

  const displayNameResult = trimAndValidateDisplayName(request.body?.displayName, usernameResult.value)
  if (!displayNameResult.ok) {
    return reply.code(400).send({ error: 'validation_error', message: displayNameResult.message })
  }

  const clientIp = request.ip ?? 'unknown'
  const canProceed = rateLimiter.check(getClientKey(clientIp, usernameResult.value))
  if (!canProceed) {
    return reply.code(429).send({ error: 'rate_limit_exceeded', message: 'Too many messages, slow down.' })
  }

  try {
    const created = await prisma.message.create({
      data: {
        id: randomUUID(),
        text: textResult.value,
        username: usernameResult.value,
        displayName: displayNameResult.value,
      },
    })

    const payload = normalizeMessage(created)
    io.emit('messages:new', payload)
    return reply.code(201).send(payload)
  } catch (error) {
    request.log.error(error, 'Could not create message')
    return reply.code(500).send({ error: 'server_error', message: 'Could not persist message' })
  }
})

io.on('connection', (socket) => {
  app.log.info({ socketId: socket.id }, 'socket connected')
  socket.on('disconnect', () => {
    app.log.info({ socketId: socket.id }, 'socket disconnected')
  })
})

app.setErrorHandler((error, _, reply) => {
  app.log.error(error, 'Unhandled request error')
  reply.code(500).send({ error: 'server_error', message: 'Internal server error' })
})

async function shutdown() {
  app.log.info('Shutting down backend')
  await new Promise<void>((resolve) => {
    io.close(() => resolve())
  })
  await app.close()
  await prisma.$disconnect()
}

process.on('SIGINT', () => {
  void shutdown().then(() => process.exit(0))
})

process.on('SIGTERM', () => {
  void shutdown().then(() => process.exit(0))
})

try {
  await prisma.$connect()
  app.log.info('Database connected')
  await app.listen({ port: BACKEND_PORT, host: '0.0.0.0' })
  app.log.info(`Backend listening on http://0.0.0.0:${BACKEND_PORT}`)
} catch (error) {
  app.log.error(error, 'Backend startup failed')
  await prisma.$disconnect()
  process.exit(1)
}
