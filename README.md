# Print Made Easy

MVP for automating document printing at print shops: customers scan a QR code, upload documents, choose print options, and the Windows Print Agent prints on the local Canon (or other) printer.

## Stack

- Next.js 15 (App Router) + TypeScript
- Tailwind CSS + shadcn/ui
- Prisma + **MySQL / MariaDB**
- Electron Windows Print Agent (HTTP polling)
- Zod validation

## Database

This project uses **MySQL/MariaDB** (not PostgreSQL).

Local database name: `printmadeeasy`

Example `DATABASE_URL`:

```env
DATABASE_URL="mysql://root:YOUR_PASSWORD@127.0.0.1:3306/printmadeeasy"
```

## Prerequisites

1. **Node.js** 20+
2. **MySQL 8** or **MariaDB 10.6+** running locally
3. Empty database created:

```sql
CREATE DATABASE printmadeeasy CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

## Setup

1. Copy `.env.example` to `.env` and set `DATABASE_URL`, `JWT_SECRET`, and `NEXT_PUBLIC_APP_URL`.
2. Install dependencies: `npm install`
3. Apply migrations: `npx prisma migrate deploy`
4. Generate client: `npx prisma generate`
5. Seed demo shop PME001: `npm run db:seed`
6. Start Next.js: `npm run dev`
7. Start Print Agent (separate folder): `cd print-agent && npm run dev`

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Next.js on `0.0.0.0:3000` |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate` | Create/apply migrations (dev) |
| `npm run db:seed` | Seed demo shop PME001 |
| `npm run db:studio` | Open Prisma Studio |

Do **not** use `prisma db push` for schema changes in normal workflow — use migrations.

## Structure

```
app/                 # Next.js App Router + API routes
components/          # UI components
lib/                 # Services (pricing, jobs, print-agent, dashboard)
prisma/              # Schema + MySQL migrations + seed
storage/uploads/     # Temporary private documents (not public)
print-agent/         # Windows Electron Print Agent
types/               # Shared TypeScript types
```

## Demo shop

- Shop code: `PME001`
- Customer upload: `/upload/PME001`
- Dashboard: `/dashboard`

## Document privacy

Uploaded files are temporary under `storage/uploads/`, downloaded by the Agent for printing, then deleted locally and on the server (max retention **1 hour**). Job metadata stays in MySQL.
