# PrintMadeEasy --- Engineering Handoff / AGENT.md

## 0. PURPOSE

You are taking over active development of the **PrintMadeEasy** project.

This document is the engineering handoff from the previous development
session. It contains the product architecture, completed phases,
important decisions, current implementation state, known limitations,
production deployment details, and the exact state of the Cashfree
subscription integration.

**Read this file before making changes.**

Do not assume that a feature is complete merely because the code/build
passes. The project has several features that were implemented and
smoke-tested locally but have not necessarily been fully verified in
production.

------------------------------------------------------------------------

# 1. PRODUCT OVERVIEW

PrintMadeEasy is a SaaS platform for print shops / cyber cafes / local
shops.

Core concept:

1.  A shopkeeper creates an account.
2.  A `Shop` is created for the shopkeeper.
3.  The shopkeeper installs the **PrintMadeEasy Windows Agent** on the
    Windows computer connected to the physical printer.
4.  The Agent is paired with the shop through the PrintMadeEasy
    dashboard.
5.  Customers can upload print jobs for a shop.
6.  The shopkeeper manages print jobs and sends them to the local
    printer through the Windows Agent.
7.  The platform has a monthly SaaS subscription for shopkeepers.
8.  An Admin area provides system-wide shop, subscription, and analytics
    visibility.

Primary production domain:

`https://clauras.com`

The current production application is hosted on Hostinger.

------------------------------------------------------------------------

# 2. IMPORTANT DEVELOPMENT RULES

## 2.1 Inspect before modifying

Before changing code:

-   inspect the current repository
-   inspect `prisma/schema.prisma`
-   inspect relevant routes/components/libs
-   inspect existing migrations
-   inspect current environment variable names
-   inspect current authentication and authorization helpers

Do not recreate existing functionality.

## 2.2 Preserve existing working features

Do NOT casually change:

-   authentication
-   shop ownership
-   print-agent pairing
-   printer detection
-   print job flow
-   subscription state model
-   Cashfree webhook verification
-   admin authorization
-   existing dashboard navigation

Make additive, targeted changes.

## 2.3 No secrets in code

Never hardcode:

-   Cashfree client ID
-   Cashfree client secret
-   webhook secret
-   database password
-   session secret
-   API credentials
-   shop tokens
-   Agent auth tokens

Never commit `.env`.

------------------------------------------------------------------------

# 3. HIGH-LEVEL DEVELOPMENT HISTORY

The project progressed through these major areas:

-   Print Agent foundation and pairing
-   QR/manual pairing
-   Windows installer
-   Shop-independent Agent identity
-   Production Agent E2E testing
-   Agent download from dashboard
-   Shop subscription architecture
-   Cashfree subscription integration
-   Subscription access enforcement
-   Admin foundation
-   Admin shop directory
-   Admin subscription dashboard

Current requested roadmap was rearranged so that **Payments + Pricing
and Admin/Analytics were prioritized before other customer-facing
improvements.**

Current development has reached approximately:

-   Agent phases: complete enough for current scope
-   Phase 4A: Pricing UI --- complete
-   Phase 4B: Subscription model --- complete
-   Phase 4C: Cashfree integration --- implemented, sandbox E2E NOT
    successfully completed
-   Phase 4D: Server-side subscription access enforcement --- complete
    locally
-   Phase 6A: Admin foundation --- complete
-   Phase 6B: Admin shops --- complete
-   Phase 6C: Admin subscriptions --- complete
-   **Phase 6D: NOT completed**

The previous developer/Cursor session stopped because the Cursor plan
usage limit was reached.

------------------------------------------------------------------------

# 4. PRINT AGENT

## 4.1 Agent purpose

The Windows Agent is a local printer bridge.

It runs on the shopkeeper's Windows computer and communicates with the
PrintMadeEasy backend.

It detects local printers and handles print jobs.

------------------------------------------------------------------------

# 5. AGENT PAIRING

## 5.1 Pairing flow

The shopkeeper can pair an Agent to a shop using a connection link
generated from:

`/dashboard/printers`

The original QR flow also exists.

The Agent UI contains:

-   Scan QR Code
-   Enter connection link manually
-   Connect
-   Cancel

### IMPORTANT PRODUCT DECISION

QR scanning is currently still present.

The QR implementation works, including webcam scanning using `jsQR`.

However, the intended production UX is now primarily **connection-link
based pairing**.

The QR option should remain for now.

It may be removed later.

Do NOT remove QR without an explicit requirement.

------------------------------------------------------------------------

# 6. AGENT QR IMPLEMENTATION

Files involved previously:

-   `print-agent/src/index.html`
-   `print-agent/src/renderer.js`
-   `print-agent/src/pairing.ts`
-   `print-agent/src/config.ts`
-   `print-agent/src/api-client.ts`
-   `print-agent/src/main.ts`
-   `print-agent/src/preload.ts`
-   `print-agent/scripts/copy-ui.js`
-   `print-agent/src/jsqr.d.ts`
-   `print-agent/package.json`

QR library:

`jsqr ^1.4.0`

Validation accepts:

`https://<host>/agent/connect?t=<token>`

Path:

`/agent/connect`

The token must be non-empty and at least 16 characters.

Host validation is restricted to the configured API host, except
localhost HTTP is allowed for local development.

Camera tracks are cleaned up on:

-   QR detection
-   Cancel
-   hide-to-tray
-   beforeunload
-   visibility hidden
-   pairing success/failure

Manual connection link uses the SAME pairing path as QR.

------------------------------------------------------------------------

# 7. AGENT IDENTITY --- IMPORTANT

A major bug was fixed where Agent IDs were derived from shop codes.

## OLD

Example:

`PME2SRN2X-WINDOWS-01`

This caused the same physical Agent to retain a shop-derived ID after
reconnecting to another shop.

## NEW

Agent IDs are device identities:

`PMEA-WINDOWS-XXXXXXXX`

Example:

`PMEA-WINDOWS-C3F6D778`

The ID:

-   is generated once
-   is persisted
-   survives restart
-   does NOT change when the Agent is paired to another shop
-   represents the physical Agent/device, not the shop

Persistence location:

`C:\ProgramData\PrintMadeEasy\agent-config.json`

Pairing changes:

-   shop
-   shop code
-   auth token

Pairing must NOT overwrite `agentId`.

Existing valid IDs such as:

-   `PMEA-WINDOWS-DEADBEEF`
-   `WIN-...`

are retained.

Packaged installs do not depend on `.env` Agent IDs.

------------------------------------------------------------------------

# 8. AGENT CONFIGURATION

Packaged installs:

-   start unpaired
-   default to `https://clauras.com`
-   do not ship `.env`
-   do not contain shop credentials
-   do not contain shop-specific Agent credentials

Paired configuration is stored locally.

The paired config takes precedence over development `.env`.

------------------------------------------------------------------------

# 9. WINDOWS INSTALLER

Packaging uses:

-   electron-builder
-   NSIS

Commands:

``` bash
cd print-agent
npm run dist
```

Also available:

``` bash
npm run build
npm run typecheck
npm run pack
```

Installer:

`print-agent/release/PrintMadeEasy-Agent-Setup-1.0.0.exe`

Installer behavior:

-   production NSIS installer
-   user can choose install directory
-   Start Menu shortcut
-   Desktop shortcut
-   uninstaller
-   `.env` excluded
-   unsigned local build

Current limitation:

-   installer is unsigned
-   Windows SmartScreen may warn
-   default Electron icon may still be used
-   no automatic updater
-   Start with Windows remains optional

------------------------------------------------------------------------

# 10. IMPORTANT AGENT DISTRIBUTION ARCHITECTURE

There should be **ONE versioned installer**, not one installer per shop.

The installer is shop-independent.

Correct model:

``` text
PrintMadeEasy-Agent-Setup-1.0.0.exe
                |
                v
       install on shop PC
                |
                v
        pair with Shop A
```

Another shop uses the same installer:

``` text
PrintMadeEasy-Agent-Setup-1.0.0.exe
                |
                v
       install on another PC
                |
                v
        pair with Shop B
```

Shop-specific relationship is created during pairing.

Future versions should use versioned installers, e.g.:

`PrintMadeEasy-Agent-Setup-1.0.1.exe`

Do not create shop-specific installer binaries.

------------------------------------------------------------------------

# 11. AGENT DOWNLOAD FROM DASHBOARD

Phase 2B-6 added a Download Windows Agent card.

Files:

-   `app/dashboard/printers/page.tsx`
-   `components/dashboard/download-windows-agent-card.tsx`
-   `lib/print-agent-download.ts`
-   `public/downloads/.gitkeep`
-   `.gitignore`

Current production installer URL:

`https://clauras.com/downloads/PrintMadeEasy-Agent-Setup-1.0.0.exe`

The installer was manually uploaded to the Hostinger deployment
filesystem because the `.exe` is gitignored.

Hostinger paths encountered:

``` text
/home/u678791565/domains/clauras.com/hbuilds/versions/.../nodejs/public/downloads
/home/u678791565/domains/clauras.com/hbuilds/last-source/public/downloads
```

The file ultimately became downloadable from the production URL.

Installer size at the time:

approximately 90 MB.

SHA-256 previously verified:

`7C616D0364C39C3029D344B1625AE9386973168B351A99E407D9EC5347EE6F23`

------------------------------------------------------------------------

# 12. AGENT LIVE TESTING COMPLETED

The following Agent behavior was manually tested:

### Shop A

-   Agent installed
-   Agent connected to a shop
-   Dashboard showed Agent Online after refresh

### Shop switching

-   Agent was paired to Shop A
-   Agent was re-paired to Shop B
-   Agent successfully connected to Shop B

### Restart

-   Agent restarted
-   paired configuration persisted

### Agent identity

After the Agent ID architecture fix:

-   Agent ID remained the same across shop changes
-   Agent ID remained the same after restart
-   Agent ID no longer came from the shop code

This was tested and confirmed working.

### Physical printer E2E

At the time of the last Agent validation, actual physical printer
printing had not been re-run after packaging.

Do not claim physical printer E2E is verified unless it is actually
tested.

------------------------------------------------------------------------

# 13. CURRENT AGENT STATUS

Agent functionality is considered sufficiently complete for current
development.

Future Agent work may include:

-   version/update strategy
-   auto-update
-   signed installer
-   better onboarding
-   production hardening

But these should not be mixed into unrelated subscription/admin work.

------------------------------------------------------------------------

# 14. SHOP SUBSCRIPTION MODEL

Subscription work started in Phase 4.

The product currently has:

## Trial

-   7-day free trial
-   no payment details required to start
-   full access during trial

## Premium

-   ₹499/month
-   monthly recurring subscription
-   Cashfree

The pricing page is:

`/dashboard/pricing`

The UI contains:

-   Start Free
-   7-Day Free Trial
-   Premium
-   ₹499/month
-   Recommended badge
-   Cashfree trust messaging
-   current subscription status

There is intentionally no ₹0 plan.

------------------------------------------------------------------------

# 15. PRICING UI --- PHASE 4A

Implemented:

`app/dashboard/pricing/page.tsx`

`components/dashboard/saas-pricing-plans.tsx`

Features:

-   7-day free trial
-   Premium ₹499/month
-   recommended styling
-   trust row
-   cancellation messaging
-   subscription status
-   Subscribe Now button

The previous customer print-rate UI that had occupied Pricing was moved
to:

`/dashboard/settings`

Do not accidentally remove shopkeeper print-rate configuration.

------------------------------------------------------------------------

# 16. SUBSCRIPTION DATABASE MODEL

Phase 4B introduced a `Subscription` model.

Relationship:

``` text
Shop 1 ---- 1 Subscription
```

Subscription plan enum:

``` text
TRIAL
PREMIUM
```

Subscription status enum:

``` text
TRIALING
ACTIVE
CANCELLED
EXPIRED
PAST_DUE
```

Important fields include:

-   shopId
-   plan
-   status
-   trialStartAt
-   trialEndAt
-   currentPeriodStart
-   currentPeriodEnd
-   cancelAtPeriodEnd
-   pastDueSince
-   provider
-   providerCustomerId
-   providerSubscriptionId
-   providerPlanId

Exact schema must always be inspected from:

`prisma/schema.prisma`

Do not invent fields if the actual schema differs.

------------------------------------------------------------------------

# 17. SUBSCRIPTION MIGRATION

Migration:

`20260819120000_add_shop_subscription`

It was additive.

Existing shops were backfilled with:

-   TRIAL
-   TRIALING
-   trialStartAt = migration time
-   trialEndAt = +7 days

Important historical caveat:

Existing shops received their 7-day trial window from migration time,
not their original signup time.

Do not silently change this behavior without a migration/data policy.

------------------------------------------------------------------------

# 18. SIGNUP SUBSCRIPTION CREATION

New signup atomically creates:

-   User
-   Shop
-   Subscription

The subscription starts as a 7-day trial.

Rollback should remove all related records if signup fails.

------------------------------------------------------------------------

# 19. SUBSCRIPTION ACCESS RULES

Centralized in:

`lib/subscription.ts`

Current intended rules:

### Access allowed

-   `TRIALING` before trial end
-   `ACTIVE`
-   `CANCELLED` before current period end
-   `PAST_DUE` within 3-day grace period

### Access denied

-   expired trial
-   expired subscription
-   cancelled after period end
-   PAST_DUE after 3-day grace
-   missing subscription

------------------------------------------------------------------------

# 20. SUBSCRIPTION ACCESS ENFORCEMENT --- PHASE 4D

Phase 4D added actual server-side enforcement.

New helper:

`lib/require-product-access.ts`

Protected areas include dashboard/product pages and APIs such as:

-   dashboard
-   jobs
-   QR
-   printers
-   settings
-   dashboard jobs APIs
-   preview APIs
-   print-agent pairing
-   customer upload/actions

Access-denied APIs return HTTP 402 where applicable.

NOT blocked:

-   login
-   signup
-   logout
-   pricing
-   subscription GET/create/cancel
-   Cashfree webhook
-   Print Agent job APIs

Do not change this casually. Product access should remain
server-enforced, not only UI-hidden.

------------------------------------------------------------------------

# 21. SUBSCRIPTION API

Existing endpoint:

`GET /api/subscription`

Returns safe information such as:

-   plan
-   status
-   trial dates
-   current period dates
-   days remaining
-   access
-   labels

It must not expose:

-   Cashfree client secret
-   webhook secret
-   sensitive tokens

------------------------------------------------------------------------

# 22. CASHFREE INTEGRATION --- PHASE 4C

Cashfree subscription integration has been implemented.

Files include:

-   `lib/cashfree.ts`
-   `lib/cashfree-webhooks.ts`
-   `lib/subscription.ts`
-   `app/api/subscription/create/route.ts`
-   `app/api/webhooks/cashfree/route.ts`

Prisma changes include:

-   `Subscription.pastDueSince`
-   index on `providerSubscriptionId`
-   `PaymentWebhookEvent`

------------------------------------------------------------------------

# 23. CASHFREE ENVIRONMENT VARIABLES

Expected server-side variables:

``` env
CASHFREE_CLIENT_ID=
CASHFREE_CLIENT_SECRET=
CASHFREE_ENVIRONMENT=sandbox
CASHFREE_PLAN_ID=
CASHFREE_WEBHOOK_SECRET=
```

Production:

``` env
CASHFREE_ENVIRONMENT=production
```

None should be `NEXT_PUBLIC_*`.

NEVER expose:

`CASHFREE_CLIENT_SECRET`

to browser/client code.

------------------------------------------------------------------------

# 24. CASHFREE API APPROACH

Server-side HTTP calls Cashfree Subscriptions API.

Sandbox host:

`https://sandbox.cashfree.com/pg/subscriptions`

Production uses Cashfree production API host.

API version:

`2025-01-01`

Headers include:

-   `x-api-version`
-   `x-client-id`
-   `x-client-secret`

Premium subscription is ₹499/month.

A configured `CASHFREE_PLAN_ID` can be used, otherwise the
implementation can create/use the inline periodic plan according to the
current code.

Always inspect the current `lib/cashfree.ts` before modifying.

------------------------------------------------------------------------

# 25. CASHFREE CHECKOUT FLOW

Current intended flow:

``` text
Shopkeeper clicks Subscribe Now
        |
        v
POST /api/subscription/create
        |
        v
Server validates session shop
        |
        v
Cashfree creates subscription
        |
        v
subscription session returned
        |
        v
Browser opens Cashfree subscription checkout
        |
        v
Customer authorizes recurring payment
        |
        v
Cashfree webhook
        |
        v
Webhook verified
        |
        v
Subscription becomes ACTIVE/PREMIUM
```

IMPORTANT:

The browser return URL does NOT activate Premium.

Premium activation happens ONLY from verified Cashfree webhook events.

------------------------------------------------------------------------

# 26. CASHFREE WEBHOOK SECURITY

Webhook endpoint:

`/api/webhooks/cashfree`

Signature logic:

``` text
timestamp + rawBody
        |
        v
HMAC-SHA256
        |
        v
Base64
        |
        v
compare x-webhook-signature
```

Comparison should be timing-safe.

Webhook idempotency is implemented.

------------------------------------------------------------------------

# 27. PAYMENT WEBHOOK EVENT MODEL

A `PaymentWebhookEvent` model was added.

Unique key:

``` text
(provider, eventId)
```

Purpose:

-   prevent duplicate webhook processing
-   preserve event metadata
-   make webhook processing idempotent

Stored metadata includes things such as:

-   provider
-   eventId
-   eventType
-   payloadHash
-   receivedAt
-   processedAt

The model intentionally does NOT expose raw sensitive webhook payloads
in admin UI.

------------------------------------------------------------------------

# 28. CASHFREE EVENT MAPPING

Important events include:

-   `SUBSCRIPTION_STATUS_CHANGED`
-   `SUBSCRIPTION_PAYMENT_SUCCESS`
-   `SUBSCRIPTION_PAYMENT_FAILED`
-   `ON_HOLD`

Successful verified events can activate Premium.

Payment failure / hold:

``` text
PAST_DUE
```

and:

``` text
pastDueSince
```

3-day grace period applies.

After grace:

access becomes false.

------------------------------------------------------------------------

# 29. CASHFREE CANCELLATION

Endpoint:

`POST /api/subscription/cancel`

Cancellation uses Cashfree manage subscription API.

Current intended behavior:

-   cancellation is at period end
-   `cancelAtPeriodEnd = true`
-   subscription remains ACTIVE until currentPeriodEnd
-   access remains available until period end
-   after period end access is denied

Do not implement immediate cancellation unless explicitly requested.

------------------------------------------------------------------------

# 30. CASHFREE SANDBOX TEST STATUS --- VERY IMPORTANT

The Cashfree integration has **NOT successfully completed a full
end-to-end subscription authorization test.**

This must be clearly understood.

We deployed/tested the integration enough to:

-   authenticate against Cashfree sandbox
-   create subscriptions
-   receive Cashfree subscription records
-   see Cashfree subscription details
-   reach hosted authorization page

A subscription appeared in Cashfree with:

-   ₹499 recurring amount
-   periodic monthly subscription
-   customer information
-   authorization link

However, authorization failed in sandbox with:

`Payment mode not enabled for this merchant.`

Cashfree dashboard showed failed payment requests with the same reason:

`Payment mode not enabled for this merchant.`

The Cashfree hosted page showed Credit/Debit Card only.

A support ticket was raised with Cashfree.

The test card used was the documented sandbox card:

``` text
4444 3333 2222 1111
03/2028
CVV 123
```

The failure was not caused by the card data.

The merchant's Cashfree sandbox subscription payment mode appears not to
be enabled.

------------------------------------------------------------------------

# 31. CASHFREE PRODUCTION STATUS

Production Cashfree subscription payment has NOT been tested.

Do not claim:

-   production subscription works
-   production webhook works
-   production recurring debit works
-   production UPI Autopay works

until explicitly verified.

The user previously used Cashfree successfully on another site,
DigiFlect, but that does NOT prove that the current Cashfree
Subscriptions product is enabled/configured for this merchant.

The DigiFlect domain later expired.

Cashfree PG and Cashfree Subscriptions are not necessarily configured
identically.

------------------------------------------------------------------------

# 32. CASHFREE UPI AUTOPAY

Current sandbox showed only:

`Credit / Debit Card`

UPI Autopay was not visible.

Cashfree documentation indicated UPI Autopay activation may require
merchant-side activation/support.

Do not redesign the integration solely because UPI is not visible in
sandbox.

First determine current Cashfree account/product configuration.

------------------------------------------------------------------------

# 33. CASHFREE TESTING LESSON

Do not falsely mark Premium ACTIVE from:

``` text
/dashboard/pricing?payment=return
```

or any browser redirect.

Only verified webhook events should activate Premium.

This is a critical security/business rule.

------------------------------------------------------------------------

# 34. ADMIN ARCHITECTURE --- PHASE 6A

Admin role support was introduced.

Prisma enum:

``` text
UserRole
```

Roles:

``` text
SHOPKEEPER
ADMIN
```

`User.role` exists.

Existing users default to:

``` text
SHOPKEEPER
```

Migration:

`20260819160000_add_user_role`

------------------------------------------------------------------------

# 35. ADMIN AUTH

Admin authorization is based on DB:

``` text
User.role
```

NOT client-provided role claims.

JWT cookie:

`pme_session`

contains basic session identity.

Role is re-read from DB.

Helpers include:

-   `requireAdmin()`
-   `requireAdminApi()`

Admin does not need a Shop.

Shopkeeper:

-   cannot access `/admin`
-   should receive redirect/403 depending on page/API

Unauthenticated:

-   login/401

------------------------------------------------------------------------

# 36. ADMIN BOOTSTRAP

Script:

`scripts/create-admin.ts`

Environment variables:

``` env
ADMIN_EMAIL=
ADMIN_NAME=
ADMIN_PASSWORD=
```

Run:

``` bash
npx tsx scripts/create-admin.ts
```

Behavior:

-   creates admin
-   or promotes existing user
-   bcrypt hashes password
-   rejects weak password
-   does not require a Shop

Never commit the admin password.

------------------------------------------------------------------------

# 37. ADMIN ROUTES

Current routes:

``` text
/admin
/admin/shops
/admin/shops/[shopId]
/admin/subscriptions
/admin/subscriptions/[subscriptionId]
/admin/analytics
```

Analytics is still a later/unfinished area depending on current
implementation.

------------------------------------------------------------------------

# 38. ADMIN OVERVIEW --- PHASE 6A

System metrics implemented include:

-   total shops
-   active shops
-   trial shops
-   premium shops
-   expired shops
-   past-due shops
-   print jobs
-   pages printed

Metrics use Prisma:

-   count
-   aggregate

Avoid loading entire tables into memory for dashboard metrics.

------------------------------------------------------------------------

# 39. ADMIN SHOP DIRECTORY --- PHASE 6B

Route:

`/admin/shops`

Read-only shop directory.

Features:

-   total
-   active
-   trial
-   premium
-   search
-   pagination

Search fields:

-   shopName
-   shopCode
-   owner.name
-   owner.email

Pagination:

-   default 20
-   max 50

API:

``` text
GET /api/admin/shops?page&pageSize&search
```

Detail:

``` text
GET /api/admin/shops/[shopId]
```

Both ADMIN-only.

------------------------------------------------------------------------

# 40. ADMIN SHOP DETAIL

Shop detail includes:

-   shop information
-   owner
-   subscription
-   printing statistics
-   B&W statistics
-   color statistics
-   printers
-   Agent ID
-   Agent status
-   last seen

It must NOT expose:

-   auth tokens
-   password hashes
-   Cashfree secrets
-   sensitive provider credentials

Performance:

-   list uses counts
-   detail uses aggregate/groupBy
-   do not load every print job/printer unnecessarily

------------------------------------------------------------------------

# 41. ADMIN SUBSCRIPTIONS --- PHASE 6C

Route:

`/admin/subscriptions`

Features:

-   subscription summary
-   search
-   status filter
-   plan filter
-   pagination
-   detail page
-   estimated MRR
-   approximate trial conversion
-   Cashfree subscription metadata
-   webhook event metadata

API:

``` text
GET /api/admin/subscriptions
GET /api/admin/subscriptions/[subscriptionId]
```

ADMIN-only.

------------------------------------------------------------------------

# 42. ADMIN MRR

Current pricing:

``` text
₹499/month
```

Estimated MRR:

``` text
ACTIVE PREMIUM subscriptions × ₹499
```

It excludes:

-   trial
-   past due
-   expired
-   cancelled after period

This is an estimate, NOT actual collected revenue.

------------------------------------------------------------------------

# 43. ACTUAL REVENUE --- CURRENT LIMITATION

Current database does NOT contain a proper payment transaction/revenue
model.

`PaymentWebhookEvent` does not currently provide a reliable accounting
ledger.

Therefore:

**Collected Revenue is currently shown as Not Available.**

Do NOT invent revenue numbers.

A future payment-history model should be introduced based on verified
successful Cashfree payment events.

------------------------------------------------------------------------

# 44. TRIAL CONVERSION --- CURRENT LIMITATION

Current admin subscription dashboard estimates trial conversion.

It is approximate because there is no complete subscription
state-history/event model.

Future improvement:

Create a proper subscription event/history model.

Example concept:

``` text
SubscriptionEvent
```

with:

-   subscriptionId
-   previousStatus
-   newStatus
-   eventType
-   timestamp
-   source/provider
-   providerEventId
-   metadata

But inspect existing schema before implementing.

------------------------------------------------------------------------

# 45. ADMIN SECURITY

Admin pages:

``` text
requireAdmin()
```

Admin APIs:

``` text
requireAdminApi()
```

Never trust:

-   shopId from client
-   role from client
-   plan from client
-   subscription status from client

Always load authoritative data from DB.

------------------------------------------------------------------------

# 46. CURRENT DATABASE CONCEPTUAL MODEL

The project currently includes, at minimum, these important entities:

``` text
User
  |
  | 1:1 / owner
  v
Shop
  |
  +---- Subscription
  |
  +---- Printer(s)
  |
  +---- PrintJob(s)
```

Subscription:

``` text
Subscription
  |
  +---- PaymentWebhookEvent (provider webhook metadata)
```

User has:

``` text
UserRole
```

The exact schema and all other entities must be inspected from:

`prisma/schema.prisma`

Do not assume this conceptual diagram is the complete schema.

------------------------------------------------------------------------

# 47. IMPORTANT EXISTING FEATURES NOT TO BREAK

The product already has:

-   authentication
-   shop signup/login
-   shop dashboard
-   shop settings
-   printer management
-   Windows Agent
-   Agent pairing
-   Agent online/offline status
-   customer print upload
-   print jobs
-   preview
-   printing pipeline
-   print rates
-   subscription trial
-   Premium subscription architecture
-   Cashfree subscription checkout
-   Cashfree webhook verification
-   subscription access gating
-   subscription cancellation
-   admin authentication
-   admin overview
-   admin shop directory
-   admin subscription dashboard

Before changing shared code, verify which routes depend on it.

------------------------------------------------------------------------

# 48. TESTING COMMANDS

Typical checks:

``` bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npx tsc --noEmit
npm run build
```

Existing smoke scripts include:

``` bash
npx tsx scripts/phase4b-subscription-smoke.ts
npx tsx scripts/phase4c-cashfree-smoke.ts
npx tsx scripts/phase4d-subscription-access-smoke.ts
npx tsx scripts/phase6a-admin-smoke.ts
npx tsx scripts/phase6b-admin-shops-smoke.ts
npx tsx scripts/phase6c-admin-subscriptions-smoke.ts
```

Previous reported results:

All of these phase smoke suites passed locally.

However, smoke tests are not equivalent to real Cashfree payment
authorization.

------------------------------------------------------------------------

# 49. PRODUCTION DEPLOYMENT --- HOSTINGER

The app is deployed on Hostinger.

Production domain:

`https://clauras.com`

When deploying database schema changes:

1.  deploy application
2.  ensure correct production environment variables
3.  run Prisma migration against production DB
4.  verify build
5.  verify application
6.  test relevant routes

Do not run destructive database commands in production.

Never use:

``` text
DROP
TRUNCATE
DELETE ALL
```

as part of a normal deployment.

------------------------------------------------------------------------

# 50. CASHFREE PRODUCTION ENVIRONMENT

Production variables must be configured separately from sandbox.

Conceptually:

``` env
CASHFREE_CLIENT_ID=<production>
CASHFREE_CLIENT_SECRET=<production>
CASHFREE_ENVIRONMENT=production
CASHFREE_PLAN_ID=<if used>
CASHFREE_WEBHOOK_SECRET=<configured secret>
```

Never copy sandbox secrets into production.

Never expose them client-side.

Before processing a real payment:

-   verify Cashfree production account/subscription activation
-   verify payment mode
-   verify webhook endpoint
-   verify webhook signature
-   verify database state transitions
-   perform one controlled real test

------------------------------------------------------------------------

# 51. CURRENT ROADMAP

Original roadmap was:

1.  Phase 2C --- Production Agent E2E + reliability
2.  Phase 2D --- Agent version/update strategy
3.  Phase 2E --- Better shop onboarding
4.  Phase 3 --- Customer-facing upload/order experience
5.  Phase 4 --- Payments + pricing
6.  Phase 5 --- Shopkeeper operational features
7.  Phase 6 --- Analytics/admin
8.  Phase 7 --- Production security/hardening

The user explicitly reordered priorities.

Current priority became:

1.  Payments/subscription
2.  Admin/analytics
3.  Other Agent/customer/operational work later

Current status:

-   Phase 4A done
-   Phase 4B done
-   Phase 4C implemented but real/sandbox authorization E2E blocked by
    Cashfree payment-mode configuration
-   Phase 4D done
-   Phase 6A done
-   Phase 6B done
-   Phase 6C done
-   Phase 6D was being started but is NOT complete

------------------------------------------------------------------------

# 52. PHASE 6D --- CURRENTLY NOT COMPLETE

The next intended work is Admin Analytics / richer analytics.

The previous Cursor session stopped because the user's Cursor Start plan
usage ended.

A failed Cursor upgrade checkout was shown.

Therefore:

**Do not claim Phase 6D is implemented.**

Start by inspecting the repository and determining exactly what Phase 6D
currently contains.

------------------------------------------------------------------------

# 53. LIKELY FUTURE ANALYTICS AREAS

Potential admin analytics:

-   daily print jobs
-   daily pages
-   B&W vs color
-   active shops
-   trial → premium conversion
-   subscription growth
-   MRR trend
-   churn/cancellations
-   failed payments
-   Agent online/offline
-   top shops by volume
-   job success/failure
-   revenue once a proper payment ledger exists

But do NOT implement all of these blindly.

First inspect the current database and existing analytics code.

Use metrics that can be supported by real stored data.

------------------------------------------------------------------------

# 54. VERY IMPORTANT BUSINESS DECISIONS

## Pricing

Current:

``` text
7-day free trial
₹499/month Premium
```

No artificial printer limit should currently be enforced unless
explicitly requested.

The pricing UI may mention printer capacity only if that is actually a
product rule.

The user previously requested not to impose arbitrary limits.

## Trial

7-day trial.

## Billing

Monthly.

## Payment provider

Cashfree.

## Agent

One versioned installer shared across all shops.

## Shop relationship

Created during pairing, not baked into installer.

------------------------------------------------------------------------

# 55. KNOWN RISKS

1.  Cashfree sandbox subscription authorization is not currently working
    because the merchant payment mode is not enabled.
2.  Production Cashfree subscription E2E is not tested.
3.  UPI Autopay availability is not confirmed.
4.  Actual revenue is not available in admin because there is no payment
    ledger.
5.  Trial conversion is approximate.
6.  Subscription history is not modeled as a full event timeline.
7.  Agent installer is unsigned.
8.  Agent auto-update is not implemented.
9.  Physical printer E2E should be explicitly reverified when relevant.
10. Existing shop trial dates came from migration time.
11. Some older subscription rows may not have the provider subscription
    ID required for Cashfree cancellation.
12. No automatic subscription expiry cron currently exists, although
    access checks are time-based.

------------------------------------------------------------------------

# 56. CODING STYLE / EXPECTATIONS

Prefer:

-   simple implementation
-   clear TypeScript
-   existing architecture
-   server-side authorization
-   Prisma queries that scale
-   selective `select`
-   count/aggregate/groupBy
-   small reusable helpers
-   explicit error handling

Avoid:

-   unnecessary abstractions
-   large refactors
-   duplicate APIs
-   duplicate subscription logic
-   client-side authorization
-   exposing provider secrets
-   loading huge tables into memory
-   fake analytics
-   fake payment success
-   changing unrelated working features

------------------------------------------------------------------------

# 57. REQUIRED WORKFLOW FOR THE NEXT DEVELOPER

Before starting a new phase:

### Step 1

Inspect repository tree.

### Step 2

Inspect:

``` text
prisma/schema.prisma
```

### Step 3

Inspect current migrations.

### Step 4

Inspect:

``` text
lib/auth.ts
lib/subscription.ts
lib/cashfree.ts
lib/cashfree-webhooks.ts
lib/admin-metrics.ts
lib/admin-shops.ts
lib/admin-subscriptions.ts
lib/require-product-access.ts
```

### Step 5

Inspect existing admin routes/components.

### Step 6

Run:

``` bash
npx tsc --noEmit
npm run build
```

### Step 7

Only then implement the next requested feature.

------------------------------------------------------------------------

# 58. DO NOT REBUILD COMPLETED PHASES

If a feature already exists:

-   inspect it
-   reuse it
-   improve it only if necessary

Do not recreate:

-   subscription model
-   Cashfree integration
-   admin auth
-   Agent pairing
-   Agent identity
-   installer
-   pricing page

unless there is a confirmed bug.

------------------------------------------------------------------------

# 59. CURRENT HANDOFF SUMMARY

At handoff:

### Working / implemented

-   PrintMadeEasy web application
-   shop authentication
-   dashboard
-   printer management
-   Windows Agent
-   Agent pairing
-   Agent-independent device identity
-   Windows installer
-   downloadable installer
-   7-day trial
-   ₹499 Premium plan
-   subscription database model
-   Cashfree subscription API integration
-   Cashfree webhook verification
-   subscription cancellation
-   server-side subscription access control
-   Admin role
-   Admin overview
-   Admin shop management
-   Admin subscription management

### Not fully verified

-   real Cashfree production recurring payment
-   sandbox Cashfree subscription authorization because merchant payment
    mode is disabled
-   UPI Autopay
-   actual collected revenue accounting

### Not completed

-   Phase 6D
-   richer analytics
-   proper payment/revenue ledger
-   subscription history/event ledger
-   Agent auto-update
-   signed installer
-   later customer/operational/security phases

------------------------------------------------------------------------

# 60. INSTRUCTION TO CODEX

Treat this document as project context, but **the repository is the
source of truth for implementation details**.

If this document conflicts with actual code:

1.  inspect the code
2.  inspect Prisma schema/migrations
3.  inspect tests
4.  preserve backward compatibility where possible
5.  report the discrepancy before making a large architectural change

Never assume a payment is successful because the browser returned.

Never expose Cashfree secrets.

Never trust client-provided role/shop/subscription state.

Never invent revenue numbers.

Never remove working Agent pairing functionality without explicit
instruction.

For every meaningful change:

1.  explain the intended change
2.  inspect existing implementation
3.  make the smallest safe change
4.  run typecheck/build
5.  run relevant smoke tests
6.  report exactly what was tested and what remains unverified
