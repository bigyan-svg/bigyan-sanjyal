# Temporary Preview database identity diagnostic

The temporary `GET /api/admin/preview-database-diagnostic` route is available
only when `VERCEL_ENV` is `preview` and requires an authenticated `ADMIN`
session. It is not linked from public or admin navigation.

The route performs ADMIN session authorization and reads the runtime Prisma
connection inside one PostgreSQL read-only transaction. Its diagnostic-specific
validator reuses the existing cookie parsing and checks the current
administrator role. After resolving the token hash, it makes the authorization
decision from a final joined read of current session and administrator state,
including role, active status,
revocation, expiry, idle timeout, and password-change validity. The transaction
uses `READ COMMITTED` and `READ ONLY`, so the joined read observes committed
account changes since the token lookup. Expiry is evaluated against a clock
sample taken after that read. The validator does not change activity timestamps
or revoke invalid sessions, and fails closed.

The response is limited to the current database name, database role, server
address and port, read-only transaction status, and Prisma migration metadata
counts. If `_prisma_migrations` is absent, migration counts are `null`. Errors
return a generic response and do not include SQL or database error details.

This route is temporary. Remove it and its supporting tests and documentation
after the Preview database identity has been verified. Do not deploy it without
separate authorization, and do not use it as a substitute for checking the
Preview and Production environment configuration.
