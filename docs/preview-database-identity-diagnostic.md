# Preview database identity diagnostic

The temporary `GET /api/admin/preview-database-identity` route is restricted to
Vercel Preview and a currently valid, active `ADMIN` session. All non-GET
methods return `405`. It does not read a request body, issue or revoke sessions,
or update session activity.

The handler uses the existing Prisma client in one `READ COMMITTED` transaction.
It sets the transaction to read-only before its first query, verifies that mode,
and then runs only `SELECT` statements. The single transaction-control statement
is `SET TRANSACTION READ ONLY`. Authentication reads only the fields needed
from `AdminSession` and `AdminUser`; it does not return those values.

The response contains only the sanitized database hostname, database name,
server port, and read-only state. It does not return the database user, server
address, session data, or connection string. Since no supported Neon branch
identity field has been established for this deployment, the response reports
`branch_identity_unavailable` rather than inferring a branch from a hostname.

The endpoint is diagnostic-only and must not be deployed or invoked without
separate authorization.
