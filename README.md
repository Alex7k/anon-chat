# anon-chat

Minimal anonymous chat app with:
- Vue 3 frontend (built static files served by Nginx)
- Fastify + Socket.IO backend
- Postgres via Prisma
- Docker Compose runtime

No auth or accounts. One global room.

## Quickstart

1. Copy env:

```sh
cp .env.example .env
# PowerShell: Copy-Item .env.example .env
```

2. Start:

```sh
docker compose up -d --build
```

3. Open:
- App: `http://localhost:5173`
- Health (proxied): `http://localhost:5173/api/health`

## Runtime Notes

- Frontend and API are same-origin through Nginx:
  - UI routes: `/`
  - API routes: `/api/*` -> backend
  - Socket.IO: `/api/socket.io` -> backend `/socket.io`
- Backend runs `prisma migrate deploy` on startup.
- Backend trusts proxy headers (for Cloudflare Tunnel / reverse proxies).
- CORS uses `CORS_ORIGIN` (comma-separated origins).

## Cloudflare Tunnel (`chat.alex7k.com`)

Point tunnel ingress to the frontend service only (port `5173` on host).  
Do not expose backend directly.

Example ingress:

```yaml
ingress:
  - hostname: chat.alex7k.com
    service: http://localhost:5173
  - service: http_status:404
```

## API

- `GET /api/health`
- `GET /api/messages?limit=200`
- `POST /api/messages` body `{ text, username, displayName }`
- Socket event: `messages:new` payload `{ id, text, username, displayName, createdAt }`
