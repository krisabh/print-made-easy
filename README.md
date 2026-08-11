# Print Made Easy

MVP for automating document printing at print shops: customers scan a QR code, upload documents, choose print options, and the Windows Print Agent prints on a local printer.

## Stack

- Next.js 15 (App Router) + TypeScript
- Tailwind CSS + shadcn/ui
- Prisma + **MySQL / MariaDB**
- Electron Windows Print Agent (HTTP polling only)
- Zod validation

## Architecture

```
Customer (QR) → Next.js → MySQL
                    ↑
         Windows Print Agent (HTTPS/HTTP APIs only)
                    ↓
                 Printer
```

The Print Agent never connects to MySQL and never embeds `DATABASE_URL`.

## Local development

### Prerequisites

1. Node.js 20+
2. MySQL 8 / MariaDB 10.6+
3. Empty database:

```sql
CREATE DATABASE printmadeeasy CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### Setup

1. Copy `.env.example` → `.env` and set values (see below steps).
2. `npm install`
3. `npx prisma migrate deploy`
4. `npx prisma generate`
5. `npm run db:seed` (local demo shop **PME001** only)
6. `npm run dev`
7. Agent: `cd print-agent && copy .env.example .env && npm install && npm run dev`

### Environment variables (server)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | MySQL connection string |
| `JWT_SECRET` | Reserved for future shopkeeper auth |
| `JWT_EXPIRES_IN` | JWT lifetime |
| `AGENT_SETUP_SECRET` | Required in production for Agent registration |
| `UPLOAD_DIR` | Private upload folder (default `storage/uploads`) |
| `MAX_UPLOAD_SIZE_MB` | Max upload size |
| `NEXT_PUBLIC_APP_URL` | Public URL for QR codes |
| `NEXT_PUBLIC_APP_NAME` | App display name |

Never put secrets in `NEXT_PUBLIC_*` variables.

### Print Agent `.env`

| Variable | Purpose |
|----------|---------|
| `PRINTMADEEASY_API_URL` | API base URL (`http://localhost:3000` or `https://YOUR-DOMAIN.com`) |
| `API_URL` | Alias for `PRINTMADEEASY_API_URL` |
| `SHOP_CODE` | Shop code (e.g. PME001) |
| `AGENT_ID` | Stable agent id |
| `AGENT_SETUP_SECRET` | Must match server `AGENT_SETUP_SECRET` in production |

## Prisma / database

- Provider: **mysql**
- Production migrate: `npx prisma migrate deploy` (or `npm run db:migrate`)
- Dev create migration: `npm run db:migrate:dev`
- **Do not** use `prisma db push` in production
- Canonical migration: `20260809111100_init_mysql`
- Seed creates demo **PME001** for local testing only and **refuses** in production unless `ALLOW_DEMO_SEED=true`

## Document privacy

- Files live under private `storage/uploads/` (not `public/`)
- Agent downloads via authenticated `GET /api/print-agent/jobs/[jobId]/file`
- Max retention: **1 hour**
- Cleanup runs on request traffic (upload, dashboard poll, agent heartbeat/register, health) — Hostinger-compatible (no background daemon)

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Next.js on `0.0.0.0:3000` |
| `npm run build` | Production build |
| `npm run start` | Production server |
| `npm run db:migrate` | `prisma migrate deploy` |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:seed` | Local demo seed only |
| `GET /api/health` | Health + DB ping |

## Production notes (Hostinger Business)

1. Create MySQL database in Hostinger panel.
2. Set env vars in Node.js app settings (`DATABASE_URL`, `AGENT_SETUP_SECRET`, `NEXT_PUBLIC_APP_URL=https://YOUR-DOMAIN.com`, `JWT_SECRET`, etc.).
3. Build/start with Hostinger’s Node.js workflow; run `npx prisma migrate deploy` and `npx prisma generate` as part of deploy.
4. **Do not** run `npm run db:seed` on production.
5. Point Print Agent `PRINTMADEEASY_API_URL` to your HTTPS domain and set matching `AGENT_SETUP_SECRET`.
6. Ensure upload directory is writable and **not** publicly served.

### Hostinger compatibility

- App is a Next.js monolith — no Redis, Docker, WebSockets, or custom daemons required.
- Document cleanup is request-driven (safe when the Node process is not always warm).
- If the site is idle for >1 hour with no requests, cleanup runs on the next request.

## Security highlights

- Server-side pricing only (client total ignored)
- Shop-scoped Agent APIs + atomic job claim (`PENDING` → `PRINTING`)
- Agent registration gated by `AGENT_SETUP_SECRET` in production
- UUID stored filenames; path traversal blocked
- APIs return generic errors (no stack traces / secrets to clients)
