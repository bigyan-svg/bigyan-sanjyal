# bigyan-sanjyal

Personal website and portfolio of Bigyan Sanjyal.

## Runtime and environment configuration

Use Node.js 22.x (22.12.0 or later within major version 22) for local work and
Vercel builds/functions. The supported range is declared in `package.json`.

Configure environment variables independently for local development, Vercel
Preview, Vercel Production, and any migration/operator workstation. Preview must
use a non-production database and separate Upstash resource; never point
Preview at production data or reuse production credentials. Use the Vercel
environment scope when setting Preview and Production values. `VERCEL` and
`NODE_ENV` are platform/runtime values; do not set `VERCEL=1` manually to
emulate Vercel on another host.

| Variable | Required when | Validation and use |
| --- | --- | --- |
| `DATABASE_URL` | Runtime database access; admin provisioning/recovery | PostgreSQL URL read lazily by the Prisma runtime client. Use a pooled/runtime endpoint for application traffic. Generation of Prisma Client does not connect to a database. |
| `DIRECT_URL` | Running a migration command | Direct PostgreSQL endpoint read by migration configuration; it does not fall back to `DATABASE_URL`. Use only for authorized migration execution. |
| `SHADOW_DATABASE_URL` | `npm run db:migrate` development workflow | Shadow PostgreSQL database URL. Keep it isolated from production data. Not used by `npm run db:migrate:deploy`. |
| `AUTH_TRUSTED_ORIGIN` | Vercel Preview/Production and non-local deployments | Exactly one trusted HTTPS origin; no path, query, or fragment. Request `Origin` must match for login, password change, logout, contact submission, and admin write requests. Local non-Vercel development instead uses `http://localhost:3000`. |
| `UPSTASH_REDIS_REST_URL` | Rate-limited operations | Must parse as HTTPS, have a hostname ending in `.upstash.io`, and contain no username, password, query, or fragment. |
| `UPSTASH_REDIS_REST_TOKEN` | Rate-limited operations | Must be non-empty after trimming. Treat as a secret and scope it to the environment's Upstash resource. |
| `ADMIN_RATE_LIMIT_HMAC_SECRET` | Rate-limited operations | At least 32 UTF-8 bytes. The application checks length, not entropy; generate at least 32 cryptographically random bytes in a secret manager and use independent values per environment. |
| `VERCEL` | Supplied by Vercel | The code accepts Vercel IP trust only when exactly `1`; never set this manually outside Vercel. |
| `ENABLE_LOCAL_LOGIN_RATE_LIMIT` | Optional local development only | Set to `true` to opt in to local rate limiting. This uses the shared `local-development` identifier, not a per-client address, and does not enable production rate limiting. |
| `NODE_ENV` | Operator CLI requires explicit `production`; otherwise supplied by runtime/tooling | The admin operator CLI refuses to run unless this is exactly `production`. Do not use this as a substitute for verifying the database target. |

Prisma generation and Next.js build do not require a live database connection.
Runtime database operations require a valid `DATABASE_URL`. Production and
Preview rate-limited operations require all three Upstash/HMAC variables and a
trusted client IP. Missing or invalid rate-limit configuration, an untrusted
client IP, or an unavailable Upstash service fails closed for login, password
change, and contact submission. The readiness check validates configuration;
it cannot prove that a request will carry the trusted IP header.

### Environment matrix

| Environment | Database values | Trusted origin | Redis and authentication secret |
| --- | --- | --- | --- |
| Local development | `DATABASE_URL` for a disposable local/dev database when using database-backed features. `DIRECT_URL` and `SHADOW_DATABASE_URL` only when running the development migration workflow; target isolated development databases. | `AUTH_TRUSTED_ORIGIN` is not required for local non-Vercel development; the code allows `http://localhost:3000`. | Upstash variables are optional unless exercising rate limiting. If `ENABLE_LOCAL_LOGIN_RATE_LIMIT=true`, configure all three rate-limit variables and a development-only Upstash resource; never reuse production credentials. |
| Vercel Preview | `DATABASE_URL` must use a dedicated, non-production Preview database and the provider-appropriate pooled runtime endpoint. | Set `AUTH_TRUSTED_ORIGIN` to the exact HTTPS Preview origin that will send write/auth requests. | Set all three rate-limit variables. Use a Preview-only Upstash resource/credentials and a separately generated HMAC secret. |
| Vercel Production | `DATABASE_URL` must use the Production database's pooled/runtime endpoint. | Set `AUTH_TRUSTED_ORIGIN` to the exact canonical HTTPS origin used for authentication and writes. | Set all three rate-limit variables. Use the Production Upstash resource/credentials and an independently generated Production HMAC secret. |
| Migration/operator execution | Migration job: `DIRECT_URL` to the intended direct database endpoint; development `npm run db:migrate` also needs an isolated `SHADOW_DATABASE_URL`. Admin operator: `DATABASE_URL` to the explicitly approved target. | Not used by Prisma migration commands or the admin operator CLI. | Not used by the migration or admin operator commands. Keep operator access independently authorized and scoped. |

Preview and Production must not share a writable database, Upstash resource,
`UPSTASH_REDIS_REST_TOKEN`, or `ADMIN_RATE_LIMIT_HMAC_SECRET`. Rate-limit key
prefixes are fixed in the application, not environment-configurable, so use
separate Upstash resources rather than relying on a configurable namespace.
Generate independent high-entropy secrets in the organization's secret manager;
do not place secret values in command arguments, shell history, source,
documentation, logs, or support tickets. Vercel `VERCEL` and runtime
`NODE_ENV` values are not application secrets.

### Controlled Vercel Preview configuration

The candidate declares Node.js `^22.12.0` in `package.json`; use Node.js 22.x
(22.12.0 or later within major version 22) for Vercel builds and functions.
There is no `vercel.json` or custom output directory. Select Vercel's Next.js
framework preset and leave output configuration at its framework default.

The project build command is `npm run build`. It runs
`prisma generate --config prisma7.config.ts` followed by `next build`; generation
does not connect to PostgreSQL or apply migrations. The repository does not
define a custom install command. Let Vercel detect the npm lockfile, or
explicitly select `npm ci` if the project settings support that choice and the
deployment log confirms it uses `package-lock.json`. Verify the effective
install and build commands in Preview logs rather than assuming dashboard
settings from repository contents.

Preview needs its own `DATABASE_URL`, `AUTH_TRUSTED_ORIGIN`,
`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and
`ADMIN_RATE_LIMIT_HMAC_SECRET`. `VERCEL` is platform-supplied. Keep `DIRECT_URL`
and `SHADOW_DATABASE_URL` out of Preview unless a separately approved isolated
migration task specifically requires them. Never connect Preview to Production
data: preview branches and test requests can mutate records, invalidate
sessions, send unintended actions, or exercise migrations and rate limits.

The installed Next.js Google Fonts loader fetches CSS from Google Fonts and
downloads font files during build unless `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` is
set. That mock was not set for the candidate production build. Therefore the
successful local build demonstrates that this environment could complete the
font fetches; it is not an offline build and does not prove that Vercel's build
environment will have equivalent network access. The build used the default
Next.js 16.4.3 Turbopack mode and completed successfully in this run.

`argon2` is pinned to 0.45.1, with Node-API version 8 native bindings. Its
installed package includes Linux x64 and arm64 binaries for both glibc and
musl, and its package README documents tested Linux targets. This is package
metadata evidence, not proof of compatibility with the actual Vercel function
image. No Linux runtime was available in the local environment for execution
testing; verify password hashing and verification in a controlled Vercel
Preview before Production.

## Database migrations and data transfer

The application uses `DATABASE_URL` at runtime. Prisma's production migration
configuration reads `DIRECT_URL`; `npm run db:migrate:deploy` runs
`prisma migrate deploy` with that direct connection. Do not run
`npm run db:migrate` against Production: it is the development
`prisma migrate dev` workflow and also requires `SHADOW_DATABASE_URL`.

Before any migration or data transfer:

1. Obtain explicit authorization and take a verified backup of the source and
   target databases. Restore a backup to an isolated scratch database and check
   representative data, row counts, relationships, and constraints before
   relying on it.
2. Keep the six migration directories in timestamp order. Apply the committed
   migrations to a fresh target before importing application data. Review the
   target's existing Prisma migration history before applying migrations to an
   existing database; do not mark migrations applied or copy
   `_prisma_migrations` without a separately reviewed procedure.
3. The first migration creates `SiteProfile` with the singleton ID `1`.
   Import/update that row rather than inserting a duplicate. Preserve dependent
   `SocialLink` rows and validate foreign-key relationships after transfer.
4. Treat data transfer separately from schema migration. Rehearse the export,
   import, and verification on an isolated target; do not import test or local
   data into Production unintentionally.
5. Decide explicitly whether to transfer admin identities. Do not transfer
   `AdminSession` rows. Creating the production administrator or changing a
   password invalidates affected sessions; sign in again after setup.
6. Preserve the verified backup and a tested restore/rollback procedure until
   the release has been accepted. Prisma migration deployment is not a
   substitute for a backup or rollback plan; do not assume schema migrations
   can be reversed automatically.

There are no automatic migration or seed commands in the application build.
Run a production migration only from an explicitly approved migration job, with
the intended `DIRECT_URL`, after backup and restore checks and release review:

```sh
npm run db:migrate:deploy
```

The build command generates Prisma Client and builds Next.js; it does not apply
database migrations.

## Administrator provisioning and recovery

### Neon Preview initial administrator bootstrap

The repository provides a dedicated Preview-only bootstrap command:

```powershell
npm run admin:preview:bootstrap
```

This command is separate from the Production operator and cannot recover,
reset, or reactivate an existing account. It creates an active `ADMIN` only when
the `AdminUser` table is empty.

Before running it:

1. Verify that the operator checkout is `phase35-release-source` at the approved
   commit.
2. Confirm the Neon branch is named `preview`, branch ID
   `br-muddy-glitter-b3nag8q7`, and database name `neondb`.
3. Independently verify the Neon Preview pooled/runtime endpoint hostname
   `ep-patient-frost-b34hmovu-pooler.c-4.ap-southeast-1.aws.neon.tech`, or the
   exact direct hostname
   `ep-patient-frost-b34hmovu.c-4.ap-southeast-1.aws.neon.tech`.
4. Run the command from a normal interactive PowerShell or VS Code terminal.
   Do not run it through a redirected, non-interactive, or automated shell.
5. Obtain the Preview pooled/runtime `DATABASE_URL` from the approved secret
   source. Do not copy credentials into command arguments, shell history, source
   files, logs, chat, or documentation.

In PowerShell, supply the secret directly in process memory with `Read-Host`.
This example does not print the URL:

```powershell
$secureDatabaseUrl = Read-Host "Neon Preview DATABASE_URL" -AsSecureString
$databaseUrlPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureDatabaseUrl)

try {
    $env:DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($databaseUrlPtr)
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($databaseUrlPtr)
}
Remove-Variable secureDatabaseUrl, databaseUrlPtr
```

Run the bootstrap from the same PowerShell process:

```powershell
npm run admin:preview:bootstrap
```

The command requires an exact Preview-specific typed confirmation immediately
before the database transaction. It prints only sanitized database host and
name information. It prompts for the administrator email, then hidden password
and password-confirmation values.
Passwords must contain 12–1,024 characters. The password is hashed with the
existing Argon2id implementation.

The command rejects malformed URLs, missing credentials, wrong databases,
unexpected ports, host override parameters, unknown hosts, and Production
endpoints. It also acquires a PostgreSQL advisory lock and uses a serializable
transaction while checking that the `AdminUser` table remains empty.
The concurrent provisioning unit test is a mocked transaction-store test; it
does not prove PostgreSQL advisory-lock behavior. Database-level concurrency
must not be represented as integration-tested until run safely against an
explicitly isolated disposable PostgreSQL test database.

Always verify the successful email-visible sign-in in Preview, then use the
authenticated password-change flow. Clear the process environment afterward:

```powershell
Remove-Item Env:DATABASE_URL
```

The operator-only CLI supports creating the first administrator and recovering
an existing active administrator. It is not an application route, and it is not
run by install, build, migration, or deployment commands. Run it only from an
approved operator workstation with the production `DATABASE_URL` supplied by
the organization's secret manager. Do not put database credentials or
passwords in command arguments, shell history, source files, or logs.
On a clean operator checkout, install the locked dependencies and run
`npm run db:generate` before supplying production credentials; client generation
does not connect to PostgreSQL.

Before either operation, obtain an approved change/incident record, independently
verify the production database host and database name in the provider console,
and ensure the operator is authorized for production account administration.
In PowerShell, set `NODE_ENV` explicitly and invoke the chosen operation:

```powershell
$env:NODE_ENV = "production"
npm run admin:operator -- provision-first
```

For a locked-out account, use the same command with `recover` instead of
`provision-first`. The CLI requires an interactive terminal, displays only the
sanitized host, port, and database name, and requires typing an operation- and
target-specific confirmation phrase. Password input is hidden, confirmed, and
validated against the application's 12-character minimum and 1,024-character
maximum; it is hashed with the existing Argon2id implementation. The CLI
suppresses unexpected database errors rather than printing connection or
credential details.

`provision-first` creates an `ADMIN` only if the `AdminUser` table is empty, in
a serializable transaction. It refuses to create a second administrator; an
existing or duplicate account must be handled through the approved recovery
process. `recover` updates only the selected, existing, active `ADMIN` and
revokes all of that account's active sessions atomically. It cannot reactivate
accounts or change roles. Both actions make a direct production database
change and therefore require operator authorization; never run either against
Preview or an unverified target.

After provisioning, verify that the expected administrator can sign in, then
use the authenticated password-change flow to rotate the initial password.
After recovery, verify sign-in with the new password and confirm prior sessions
are rejected. Record the approval reference, operator, timestamp, verified
target, operation, and resulting account ID in the organization's restricted
change log; do not record passwords, hashes, session tokens, or the database
URL. Remove the production database credential from the operator environment
when finished.

For rollback, do not attempt to restore password hashes or sessions from logs.
If the initial account is wrong, stop sign-in access and use the approved
database incident procedure to disable it; do not delete it casually. If a
recovery password is wrong, repeat the authorized `recover` operation with a
new password; revoked sessions are intentionally not restored. Preserve the
change record and investigate any unexpected account or target result before
continuing deployment.

## Cloudflare DNS and Vercel client-IP staging

Add the domain to Vercel and copy the required DNS record type, name, and target
from the Vercel domain dashboard. Do not guess record values. Configure
Cloudflare DNS without conflicting records, and initially use DNS-only mode
while verifying Vercel domain validation and HTTPS.

The application's configured trust contract is narrow: only the
`x-vercel-forwarded-for` request header is accepted, and only when `VERCEL=1`.
It must contain exactly one valid IP address. Generic `x-forwarded-for` and
Cloudflare `cf-connecting-ip` are ignored, as are comma-separated values. A
missing, malformed, or untrusted address does not fall back to another header:
login, password change, and contact submission rate limits return unavailable
and those operations fail closed.

This is the header the application expects from its Vercel ingress; source
inspection cannot establish whether the deployed Vercel request path supplies
it, overwrites client-supplied copies, or preserves it when Cloudflare proxying
is enabled. The readiness check only sees `VERCEL=1` and valid Redis/HMAC
configuration; it cannot establish that an individual request contains a
trusted address. Cloudflare may supply its own client-IP header, but this
application intentionally does not trust it. Treat IP attribution and
rate-limit availability as unverified until demonstrated in isolated staging.

Before enabling Cloudflare proxying, test the full path in an isolated staging
deployment with staging-only database and Upstash resources:

1. Keep Cloudflare DNS-only initially. Use Vercel's dashboard-provided DNS
   values and avoid conflicting A, AAAA, or CNAME records. Verify Vercel domain
   validation, HTTPS issuance, and the intended canonical hostname before
   testing authentication.
2. Confirm Preview has its own database, Upstash resource, token, HMAC secret,
   and `AUTH_TRUSTED_ORIGIN`. Confirm the Vercel runtime has `VERCEL=1` without
   manually setting it. Never use Production credentials or data for Preview.
3. Send staging login requests from two separate client networks. Verify each
   request is assigned the actual visitor IP by the `x-vercel-forwarded-for`
   policy, each network gets a distinct IP bucket, and repeated attempts for a
   normalized email share the intended account bucket. Test with forged
   `x-vercel-forwarded-for`, `x-forwarded-for`, and `cf-connecting-ip` request
   headers to verify the ingress does not let a client choose its own trusted
   identity. Confirm throttled responses remain generic.
4. Repeat the same tests through the Cloudflare-proxied staging hostname. Check
   that the trusted header remains valid and represents the actual visitor, not
   Cloudflare or an attacker-controlled value. A successful DNS/TLS check alone
   does not verify this.
5. If any path omits or changes the trusted signal, leave Cloudflare proxying
   disabled (DNS-only) while obtaining a provider-supported design and
   repeating staging verification. Do not compensate by trusting arbitrary
   forwarding headers or by weakening fail-closed behavior.
6. Do not log, return, or otherwise expose raw forwarded-IP headers.

Verify TLS and security headers at the deployed hostname. The repository does
not configure a Content-Security-Policy; review any platform-supplied headers
and test any proposed CSP against Next.js scripts, styles, images, login, and
admin functionality before enabling it.

### Pre-deployment verification checklist

- [ ] Confirm Vercel Production and Preview each have the intended, isolated
  environment-variable scopes; inspect names/configuration without printing
  secret values.
- [ ] Confirm Preview's `DATABASE_URL` is a disposable non-production pooled
  runtime endpoint and is not writable production data.
- [ ] Confirm Production `DATABASE_URL` is the pooled runtime endpoint;
  migration execution uses the intended direct `DIRECT_URL`.
- [ ] Confirm `AUTH_TRUSTED_ORIGIN` exactly matches each environment's HTTPS
  site origin, with no path, and that redirects/canonical-host behavior agree.
- [ ] Confirm separate Preview and Production Upstash resources and tokens,
  plus independently generated `ADMIN_RATE_LIMIT_HMAC_SECRET` values meeting
  the 32-byte minimum.
- [ ] Confirm `VERCEL=1` is platform-supplied, then verify trusted client-IP
  attribution and fail-closed behavior on the actual Vercel Preview ingress.
- [ ] Keep Cloudflare DNS-only until direct and proxied staging requests both
  pass forged-header and multi-network rate-limit checks. Do not enable proxy
  for Production until those checks pass.
- [ ] Confirm HTTPS, secure session cookies, HSTS behavior, and response
  security headers on deployed Preview; check error responses and auth/admin
  routes as well as the homepage.
- [ ] Review pending database migrations, obtain approval, verify backups and
  restore procedure, and run migrations only through the approved job using
  `DIRECT_URL`.
- [ ] Provision the first Production administrator only through the documented
  operator procedure after independently verifying the production target.
- [ ] Record build/deployment identifiers and rollback owner; verify a known
  rollback procedure before promoting the release.

For this candidate, a controlled Preview is **not ready to start yet** until
the release is placed in a verifiable Git baseline and the Preview's isolated
environment variables and database have been provisioned and reviewed. After
those prerequisites, Preview promotion remains conditional on the actual
Vercel build, Linux Argon2 smoke test, and trusted-IP/Cloudflare staging checks
passing. Do not copy Production database or Upstash values into Preview.

## Local development and checks

Install dependencies with the repository lockfile, configure local environment
variables without committing `.env` files, then use:

```sh
npm run dev
npm test
npx tsc --noEmit
npm run lint
npm run build
```

`npm run dev` generates the Prisma Client from `prisma/schema.prisma` before
starting Next.js. Client generation does not connect to PostgreSQL; database
access occurs only when application code performs a database operation.

`npm run db:migrate` is a development-only schema workflow. Database integration
verification and concurrency tests require an isolated test database and must
not be pointed at Production.
