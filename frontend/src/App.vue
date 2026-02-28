<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { io, type Socket } from 'socket.io-client'

type ChatMessage = {
  id: string
  text: string
  username: string
  displayName: string
  createdAt: string
}

const DISPLAY_NAME_STORAGE_KEY = 'anon-chat-display-name'
const MAX_TEXT_LENGTH = 1000
const API_BASE = import.meta.env.VITE_API_URL ?? '/api'
const SOCKET_PATH = import.meta.env.VITE_SOCKET_PATH ?? '/api/socket.io'

const message_sound = new Audio('message.mp3')
const messages = ref<ChatMessage[]>([])
const messageText = ref('')
const username = ref('')
const displayName = ref('')
const errorMessage = ref('')
const isSending = ref(false)
const connectionState = ref<'connecting' | 'connected' | 'disconnected'>('connecting')
const onlineCount = ref(0)
const listElement = ref<HTMLElement | null>(null)

let socket: Socket | null = null

const charCount = computed(() => messageText.value.length)
const statusText = computed(() => {
  if (connectionState.value === 'connected') {
    return `${onlineCount.value} online`
  }

  return connectionState.value
})

async function loadIdentity() {
  const savedDisplayName = localStorage.getItem(DISPLAY_NAME_STORAGE_KEY)?.trim()
  const response = await fetch(`${API_BASE}/identity`, {
    credentials: 'include',
  })
  if (!response.ok) {
    throw new Error('Could not initialize identity')
  }

  const payload = (await response.json()) as { username: string }
  const serverUsername = payload.username.trim().slice(0, 64)
  if (!serverUsername) {
    throw new Error('Invalid identity response')
  }

  username.value = serverUsername

  displayName.value = (savedDisplayName || username.value).slice(0, 64)
  localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, displayName.value)
}

function saveDisplayName() {
  const cleanName = displayName.value.trim().slice(0, 64)
  displayName.value = cleanName || username.value
  localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, displayName.value)
}

function getAvatarInitials(rawUsername: string) {
  const compact = rawUsername.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
  return compact.slice(0, 2) || 'AN'
}

function avatarStyle(rawUsername: string) {
  let hash = 0
  for (let i = 0; i < rawUsername.length; i += 1) {
    hash = (hash * 31 + rawUsername.charCodeAt(i)) % 360
  }
  return { background: `hsl(${hash} 70% 46%)` }
}

async function scrollToBottom() {
  await nextTick()
  if (!listElement.value) {
    return
  }

  listElement.value.scrollTop = listElement.value.scrollHeight
}

async function loadMessages() {
  const response = await fetch(`${API_BASE}/messages?limit=200`, {
    credentials: 'include',
  })
  if (!response.ok) {
    throw new Error('Could not load messages')
  }

  const payload = (await response.json()) as { messages: ChatMessage[] }
  messages.value = payload.messages
  await scrollToBottom()
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function loadMessagesWithRetry(attempts = 5, delayMs = 600) {
  let lastError: unknown

  for (let i = 0; i < attempts; i += 1) {
    try {
      await loadMessages()
      return
    } catch (error) {
      lastError = error
      if (i < attempts - 1) {
        await sleep(delayMs)
      }
    }
  }

  throw lastError
}

function connectSocket() {
  socket = io(API_BASE === '/api' ? undefined : API_BASE, {
    path: SOCKET_PATH,
    transports: ['websocket', 'polling'],
    withCredentials: true,
  })

  socket.on('connect', async () => {
    connectionState.value = 'connected'

    // If initial history failed during backend startup, recover on socket connect.
    if (messages.value.length === 0) {
      try {
        await loadMessages()
        errorMessage.value = ''
      } catch {
        // Keep existing UX; user can still receive live messages.
      }
    }
  })

  socket.on('disconnect', () => {
    connectionState.value = 'disconnected'
    onlineCount.value = 0
  })

  socket.on('presence:count', (count: unknown) => {
    if (typeof count === 'number' && Number.isFinite(count) && count >= 0) {
      onlineCount.value = Math.floor(count)
    }
  })

  socket.on('messages:new', async (message: ChatMessage) => {
    messages.value.push(message)
    if (message.username !== username.value) {
      void message_sound.play()
    }
    await scrollToBottom()
  })
}

async function sendMessage() {
  errorMessage.value = ''
  const cleanText = messageText.value.trim()

  if (!cleanText) {
    errorMessage.value = 'Message cannot be empty.'
    return
  }

  if (cleanText.length > MAX_TEXT_LENGTH) {
    errorMessage.value = `Message must be ${MAX_TEXT_LENGTH} characters or less.`
    return
  }

  isSending.value = true
  try {
    const response = await fetch(`${API_BASE}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        text: cleanText,
        displayName: displayName.value,
      }),
    })

    if (!response.ok) {
      const payload = (await response.json()) as { message?: string }
      throw new Error(payload.message ?? 'Message send failed')
    }

    messageText.value = ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Message send failed'
  } finally {
    isSending.value = false
  }
}

function onComposerKeyDown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void sendMessage()
  }
}

function formatTimestamp(timestamp: string) {
  const messageDate = new Date(timestamp)
  const now = new Date()
  const isToday =
    messageDate.getFullYear() === now.getFullYear() &&
    messageDate.getMonth() === now.getMonth() &&
    messageDate.getDate() === now.getDate()

  const year = messageDate.getFullYear()
  const month = String(messageDate.getMonth() + 1).padStart(2, '0')
  const day = String(messageDate.getDate()).padStart(2, '0')

  const rawHours = messageDate.getHours()
  const minutes = String(messageDate.getMinutes()).padStart(2, '0')
  const period = rawHours >= 12 ? 'PM' : 'AM'
  const hour12 = rawHours % 12 === 0 ? 12 : rawHours % 12
  const hours = String(hour12).padStart(2, '0')

  if (isToday) {
    return `${hours}:${minutes} ${period}`
  }

  return `${year}-${month}-${day} ${hours}:${minutes} ${period}`
}

onMounted(async () => {
  try {
    await loadIdentity()
    await loadMessagesWithRetry()
  } catch {
    errorMessage.value = 'Could not initialize chat.'
  }
  connectSocket()
})

onUnmounted(() => {
  socket?.disconnect()
})
</script>

<template>
  <main class="chat-app">
    <header class="topbar">
      <h1>Alex7k Anonymous Chat</h1>
      <div class="topbar-right">
        <label class="identity-field">
          <span>Display Name</span>
          <input
            id="displayName"
            v-model="displayName"
            maxlength="64"
            @change="saveDisplayName"
          />
        </label>
        <p class="username-tag">@{{ username }}</p>
        <p class="status" :class="`status-${connectionState}`">{{ statusText }}</p>
      </div>
    </header>

    <section ref="listElement" class="messages">
      <p v-if="messages.length === 0" class="empty">No messages yet.</p>
      <article v-for="message in messages" :key="message.id" class="message">
        <div class="avatar" :style="avatarStyle(message.username)" aria-hidden="true">
          {{ getAvatarInitials(message.username) }}
        </div>
        <div class="message-body">
          <p class="meta">
            <strong>{{ message.displayName }}</strong>
            <span v-if="message.displayName !== message.username" class="meta-username"
              >@{{ message.username }}</span
            >
            <time :datetime="message.createdAt">{{ formatTimestamp(message.createdAt) }}</time>
          </p>
          <p class="text">{{ message.text }}</p>
        </div>
      </article>
    </section>

    <form class="composer" @submit.prevent="sendMessage">
      <textarea
        v-model="messageText"
        :maxlength="MAX_TEXT_LENGTH"
        rows="3"
        placeholder="Write a message..."
        @keydown="onComposerKeyDown"
      />
      <div class="composer-row">
        <p class="count">{{ charCount }}/{{ MAX_TEXT_LENGTH }}</p>
        <button type="submit" :disabled="isSending">{{ isSending ? 'Sending...' : 'Send' }}</button>
      </div>
      <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
    </form>
  </main>
</template>

<style scoped>
:global(*) {
  box-sizing: border-box;
}

:global(body) {
  margin: 0;
  min-height: 100vh;
  font-family: Inter, 'SF Pro Display', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  color: #dde5f8;
  background:
    radial-gradient(1300px 800px at 10% -20%, #24355c 0%, transparent 55%),
    radial-gradient(1200px 760px at 100% -10%, #412460 0%, transparent 50%), #0f1420;
}

.chat-app {
  display: grid;
  grid-template-rows: auto 1fr auto;
  height: 100vh;
  width: 100vw;
  padding: 0.85rem;
  gap: 0.8rem;
  overflow: hidden;
}

.topbar {
  border: 1px solid #25324a;
  border-radius: 14px;
  background: rgba(16, 23, 38, 0.78);
  backdrop-filter: blur(10px);
  padding: 0.85rem 0.95rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.topbar h1 {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: #f1f5ff;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.identity-field {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.identity-field span {
  font-size: 0.76rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #9aa8c7;
}

.identity-field input {
  width: 14rem;
  border: 1px solid #31415f;
  border-radius: 10px;
  background: #111b2f;
  color: #f0f4ff;
  padding: 0.5rem 0.6rem;
  transition:
    border-color 0.16s ease,
    box-shadow 0.16s ease;
}

.identity-field input:focus {
  outline: none;
  border-color: #5b7fff;
  box-shadow: 0 0 0 3px rgba(91, 127, 255, 0.2);
}

.username-tag {
  margin: 0;
  border: 1px solid #33415f;
  border-radius: 999px;
  background: #111b2f;
  color: #9fb0d3;
  font-size: 0.76rem;
  padding: 0.32rem 0.62rem;
}

.status {
  margin: 0;
  font-size: 0.78rem;
  text-transform: capitalize;
  border: 1px solid #33415f;
  border-radius: 999px;
  padding: 0.3rem 0.65rem;
  background: #111b2f;
}

.status-connected {
  color: #62e694;
}

.status-connecting,
.status-disconnected {
  color: #f4bf61;
}

.messages {
  border: 1px solid #25324a;
  border-radius: 14px;
  background: rgba(15, 22, 37, 0.72);
  backdrop-filter: blur(9px);
  min-height: 0;
  overflow-y: auto;
  padding: 0.75rem 0.95rem;
  scroll-behavior: smooth;
}

.empty {
  margin: 0.45rem 0;
  color: #9ba8c5;
}

.message {
  display: grid;
  grid-template-columns: 2.5rem 1fr;
  gap: 0.7rem;
  border-radius: 10px;
  padding: 0.55rem 0.45rem;
  transition: background 0.16s ease;
}

.message:hover {
  background: #1a2741;
}

.avatar {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 50%;
  background: linear-gradient(135deg, #4d75ff, #39a2ff);
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.03em;
}

.message-body {
  min-width: 0;
}

.meta {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin: 0 0 0.2rem 0;
  font-size: 0.78rem;
  color: #9eabc7;
}

.meta strong {
  color: #f3f7ff;
  font-size: 0.9rem;
  font-weight: 600;
}

.meta-username {
  color: #8e9dbc;
}

.text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.45;
  color: #d9e1f4;
}

.composer {
  border: 1px solid #25324a;
  border-radius: 14px;
  background: rgba(16, 23, 38, 0.78);
  backdrop-filter: blur(10px);
  padding: 0.75rem;
  display: grid;
  gap: 0.52rem;
}

.composer textarea {
  width: 100%;
  resize: vertical;
  min-height: 2.9rem;
  max-height: 12rem;
  border: 1px solid #31415f;
  border-radius: 10px;
  background: #101a2e;
  color: #f0f4ff;
  padding: 0.7rem 0.78rem;
  line-height: 1.4;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.composer textarea::placeholder {
  color: #90a1c2;
}

.composer textarea:focus {
  outline: none;
  border-color: #5b7fff;
  background: #111e35;
}

.composer-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.count {
  margin: 0;
  color: #95a6c8;
  font-size: 0.77rem;
}

.composer button {
  border: 1px solid #3d60cf;
  border-radius: 10px;
  background: linear-gradient(135deg, #446dff, #5b7fff);
  color: #f8fbff;
  padding: 0.52rem 0.95rem;
  font-size: 0.84rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    transform 0.15s ease,
    filter 0.15s ease,
    background 0.15s ease;
}

.composer button:hover:enabled {
  transform: translateY(-1px);
  filter: brightness(1.07);
}

.composer button:disabled {
  border-color: #364055;
  background: #364055;
  color: #b6c1d6;
  cursor: not-allowed;
}

.error {
  margin: 0;
  color: #ff8798;
  font-size: 0.8rem;
}

@media (max-width: 860px) {
  .chat-app {
    padding: 0.6rem;
    gap: 0.62rem;
  }

  .topbar {
    flex-direction: column;
    align-items: stretch;
  }

  .topbar-right {
    justify-content: space-between;
  }

  .identity-field {
    flex: 1;
  }

  .identity-field input {
    width: 100%;
  }
}
</style>
