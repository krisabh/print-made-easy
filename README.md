<<<<<<< HEAD
# Print Made Easy

MVP skeleton for automating document printing at print shops, Xerox centers, cyber cafes, libraries, and CSC centers.

## Stack

- Next.js 15 (App Router) + TypeScript
- Tailwind CSS + shadcn/ui
- Prisma + PostgreSQL
- JWT auth, React Hook Form, Zod, pdf.js

## Setup

1. Copy `.env.example` to `.env` and set `DATABASE_URL` and `JWT_SECRET`.
2. Install dependencies: `npm install`
3. Generate Prisma client: `npm run db:generate`
4. Start dev server: `npm run dev`

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Next.js (Turbopack) |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:push` | Push schema to database |
| `npm run db:migrate` | Run migrations |
| `npm run db:studio` | Open Prisma Studio |

## Structure

```
app/              # Next.js App Router
components/       # UI components (shadcn in components/ui)
lib/              # Shared utilities (Prisma client, cn)
prisma/           # Prisma schema
public/uploads/   # Uploaded files
electron/         # Desktop shell (later)
types/            # Shared TypeScript types
```
=======

