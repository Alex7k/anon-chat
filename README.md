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

1. Start:

```sh
docker compose up -d --build
```

1. Open:

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
tunnel: 96f6eb83-8fb7-4cae-8a78-0a247cf89f18
credentials-file: /home/<user>/.cloudflared/96f6eb83-8fb7-4cae-8a78-0a247cf89f18.json

ingress:
  - hostname: chat.alex7k.com
    service: http://localhost:5173
  - service: http_status:404
```

Start tunnel manually:

```sh
cloudflared tunnel run 96f6eb83-8fb7-4cae-8a78-0a247cf89f18
```

## Auto-start on Reboot (Linux)

Docker Compose services are configured with:

```yaml
restart: unless-stopped
```

Enable Docker on boot:

```sh
sudo systemctl enable --now docker
```

Create a Cloudflared systemd service (`/etc/systemd/system/cloudflared.service`):

```ini
[Unit]
Description=Cloudflare Tunnel
After=network-online.target
Wants=network-online.target

[Service]
User=<user>
WorkingDirectory=/home/<user>
ExecStart=/usr/local/bin/cloudflared --config /home/<user>/.cloudflared/config.yml tunnel run 96f6eb83-8fb7-4cae-8a78-0a247cf89f18
Restart=always
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

Enable it:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
```

## API

- `GET /api/health`
- `GET /api/messages?limit=200`
- `POST /api/messages` body `{ text, username, displayName }`
- Socket event: `messages:new` payload `{ id, text, username, displayName, createdAt }`
