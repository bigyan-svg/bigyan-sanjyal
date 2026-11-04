import "server-only";

export const DEFAULT_RECOVERY_DATABASE_NAME = "bigyan_sanjyal_db";
export const DEFAULT_RECOVERY_DATABASE_PORT = 5432;

const DATABASE_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,62}$/u;
const SAFE_QUERY_PARAMETERS = new Set(["schema"]);
const PRODUCTION_DATABASE_NAME_PATTERN = /(?:^|[_-])(?:prod(?:uction)?|live|primary)\d*(?:$|[_-])/iu;

export interface RecoveryDatabaseEnvironment {
  nodeEnv: string | undefined;
  vercel: string | undefined;
  databaseUrl: string | undefined;
  expectedDatabaseName: string | undefined;
  expectedDatabasePort: string | undefined;
}

export interface RecoveryDatabaseTarget {
  host: "localhost" | "127.0.0.1" | "::1";
  port: number;
  database: string;
}

export interface RecoveryDatabaseServerIdentity {
  databaseName: string;
  serverAddress: string | null;
  serverPort: number | null;
}

export class UnsafeRecoveryDatabaseTargetError extends Error {
  constructor() {
    super("The recovery database target could not be verified as the expected local development database.");
    this.name = "UnsafeRecoveryDatabaseTargetError";
  }
}

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  if (!/^[1-9]\d{0,4}$/u.test(value)) throw new UnsafeRecoveryDatabaseTargetError();

  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65_535) {
    throw new UnsafeRecoveryDatabaseTargetError();
  }
  return port;
}

function isLoopbackHostname(hostname: string): hostname is RecoveryDatabaseTarget["host"] {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (normalized === "localhost" || normalized === "::1") return true;

  // Only accept the canonical IPv4 loopback address. Reject alternate numeric,
  // mapped IPv6, DNS aliases, and suffix tricks instead of guessing how they resolve.
  return normalized === "127.0.0.1";
}

function assertSafeExpectedDatabaseName(databaseName: string): void {
  if (
    !DATABASE_NAME_PATTERN.test(databaseName) ||
    PRODUCTION_DATABASE_NAME_PATTERN.test(databaseName)
  ) {
    throw new UnsafeRecoveryDatabaseTargetError();
  }
}

export function resolveRecoveryDatabaseTarget(
  environment: RecoveryDatabaseEnvironment,
): RecoveryDatabaseTarget {
  if (environment.nodeEnv !== "development" || environment.vercel?.trim()) {
    throw new UnsafeRecoveryDatabaseTargetError();
  }

  const databaseUrl = environment.databaseUrl;
  if (
    !databaseUrl ||
    databaseUrl !== databaseUrl.trim() ||
    /[\u0000-\u001f\u007f]/u.test(databaseUrl)
  ) {
    throw new UnsafeRecoveryDatabaseTargetError();
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new UnsafeRecoveryDatabaseTargetError();
  }

  if (
    (parsedUrl.protocol !== "postgres:" && parsedUrl.protocol !== "postgresql:") ||
    parsedUrl.hash !== "" ||
    !isLoopbackHostname(parsedUrl.hostname)
  ) {
    throw new UnsafeRecoveryDatabaseTargetError();
  }

  // node-postgres allows `host` and `port` URL parameters to override the
  // authority. Reject every query parameter except Prisma's non-routing schema.
  const queryKeys = [...parsedUrl.searchParams.keys()];
  if (
    queryKeys.some((key) => !SAFE_QUERY_PARAMETERS.has(key)) ||
    new Set(queryKeys).size !== queryKeys.length ||
    parsedUrl.searchParams.getAll("schema").some((schema) => schema !== "public")
  ) {
    throw new UnsafeRecoveryDatabaseTargetError();
  }

  let database: string;
  try {
    database = decodeURIComponent(parsedUrl.pathname.slice(1));
  } catch {
    throw new UnsafeRecoveryDatabaseTargetError();
  }

  const expectedDatabaseName = environment.expectedDatabaseName || DEFAULT_RECOVERY_DATABASE_NAME;
  const expectedPort = parsePort(environment.expectedDatabasePort, DEFAULT_RECOVERY_DATABASE_PORT);
  assertSafeExpectedDatabaseName(expectedDatabaseName);

  const port = parsedUrl.port ? Number(parsedUrl.port) : DEFAULT_RECOVERY_DATABASE_PORT;
  if (
    !Number.isSafeInteger(port) ||
    port !== expectedPort ||
    database !== expectedDatabaseName
  ) {
    throw new UnsafeRecoveryDatabaseTargetError();
  }

  return {
    host: parsedUrl.hostname.replace(/^\[|\]$/gu, "") as RecoveryDatabaseTarget["host"],
    port,
    database,
  };
}

export function assertRecoveryDatabaseServerIdentity(
  target: RecoveryDatabaseTarget,
  identity: RecoveryDatabaseServerIdentity,
): void {
  if (
    identity.databaseName !== target.database ||
    identity.serverPort !== target.port ||
    identity.serverAddress === null ||
    !isLoopbackHostname(identity.serverAddress)
  ) {
    throw new UnsafeRecoveryDatabaseTargetError();
  }
}

export async function withVerifiedRecoveryDatabaseTarget<T>(
  environment: RecoveryDatabaseEnvironment,
  inspectServer: () => Promise<RecoveryDatabaseServerIdentity>,
  recover: (target: RecoveryDatabaseTarget) => Promise<T>,
): Promise<T> {
  const target = resolveRecoveryDatabaseTarget(environment);

  let identity: RecoveryDatabaseServerIdentity;
  try {
    identity = await inspectServer();
  } catch {
    throw new UnsafeRecoveryDatabaseTargetError();
  }

  assertRecoveryDatabaseServerIdentity(target, identity);
  return recover(target);
}
