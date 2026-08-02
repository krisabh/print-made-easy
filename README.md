# PrintMadeEasy

Multi-tenant print-ordering platform: customers scan a shop QR code and upload documents from mobile web; shop operators approve and optionally auto-print through a local Electron agent.

## Workspace

- `apps/customer-web` — Next.js customer upload and print-configurator experience.
- `apps/shop-desktop` — Electron operations dashboard, OS printer discovery, and silent-print bridge.
- `apps/backend-api` — NestJS service shell with the scheduled, storage-safe document purge worker.
- `packages/shared-types` — shared job, shop and print-option contracts.
- `supabase/schema.sql` — PostgreSQL/Supabase schema, RLS policies and one-hour post-terminal-status retention trigger.

## Run locally

1. Install Node.js 20+ and pnpm 9+.
2. `pnpm install`
3. `docker compose up -d postgres redis`
4. Copy the required API environment variables (`DATABASE_URL`, `AWS_REGION`, `S3_ENDPOINT`) into your local environment.
5. Run `pnpm dev:customer`, `pnpm dev:desktop`, or `pnpm dev:api`.

Documents must live in a private, encrypted S3-compatible bucket. The worker runs every minute, claims due rows with `FOR UPDATE SKIP LOCKED`, deletes the source object, and marks the job purged. A job becomes eligible precisely one hour after it moves to `completed` or `cancelled`.
