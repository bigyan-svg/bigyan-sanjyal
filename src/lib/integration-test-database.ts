import { URL } from "node:url";

export const INTEGRATION_TEST_DATABASE_HOST = "127.0.0.1";
export const INTEGRATION_TEST_DATABASE_PORT = 55_432;
export const INTEGRATION_TEST_DATABASE_NAME = "bigyan_sanjyal_concurrency_test";
export const INTEGRATION_TEST_DATABASE_USER = "bigyan_sanjyal_concurrency_test_user";
export const PHASE38_TEST_DATABASE_HOST = "127.0.0.1";
export const PHASE38_TEST_DATABASE_PORT = 5432;
export const PHASE38_TEST_DATABASE_NAME = "bigyan_sanjyal_phase38_test";
export const PHASE38_TEST_DATABASE_USER = "bigyan_sanjyal_phase38_test";

const SAFE_QUERY_PARAMETERS = new Set(["schema"]);

export interface IntegrationTestDatabaseEnvironment {
  testDatabaseUrl: string | undefined;
  developmentDatabaseUrl: string | undefined;
  nodeEnv: string | undefined;
  vercel: string | undefined;
}

export interface IntegrationTestDatabaseTarget {
  host: typeof INTEGRATION_TEST_DATABASE_HOST | typeof PHASE38_TEST_DATABASE_HOST;
  port: typeof INTEGRATION_TEST_DATABASE_PORT | typeof PHASE38_TEST_DATABASE_PORT;
  database: typeof INTEGRATION_TEST_DATABASE_NAME | typeof PHASE38_TEST_DATABASE_NAME;
  user: typeof INTEGRATION_TEST_DATABASE_USER | typeof PHASE38_TEST_DATABASE_USER;
}

export interface IntegrationTestDatabaseServerIdentity {
  databaseName: string;
  userName: string;
  serverAddress: string | null;
  serverPort: number | null;
}

export class UnsafeIntegrationTestDatabaseTargetError extends Error {
  constructor() {
    super("The integration test database target could not be verified.");
    this.name = "UnsafeIntegrationTestDatabaseTargetError";
  }
}

interface ParsedDatabaseTarget {
  host: string;
  rawHost: string;
  port: number;
  database: string;
  user: string;
}

const APPROVED_INTEGRATION_TEST_TARGETS: readonly IntegrationTestDatabaseTarget[] = [
  {
    host: INTEGRATION_TEST_DATABASE_HOST,
    port: INTEGRATION_TEST_DATABASE_PORT,
    database: INTEGRATION_TEST_DATABASE_NAME,
    user: INTEGRATION_TEST_DATABASE_USER,
  },
  {
    host: PHASE38_TEST_DATABASE_HOST,
    port: PHASE38_TEST_DATABASE_PORT,
    database: PHASE38_TEST_DATABASE_NAME,
    user: PHASE38_TEST_DATABASE_USER,
  },
];

function normalizeLoopbackHost(host: string): string | null {
  const normalized = host.toLowerCase().replace(/^\[|\]$/gu, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1"
    ? "127.0.0.1"
    : null;
}

function getRawEndpoint(value: string): { hostname: string; port?: string } | null {
  const authorityMatch = /^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/iu.exec(value);
  if (!authorityMatch?.[1]) return null;

  const authority = authorityMatch[1];
  const hostAndPort = authority.slice(authority.lastIndexOf("@") + 1);
  if (hostAndPort.startsWith("[")) {
    const closingBracket = hostAndPort.indexOf("]");
    if (closingBracket === -1) return null;
    const hostname = hostAndPort.slice(0, closingBracket + 1);
    const remainder = hostAndPort.slice(closingBracket + 1);
    if (remainder === "") return { hostname };
    const port = /^:(\d+)$/u.exec(remainder)?.[1];
    return port ? { hostname, port } : null;
  }

  const colon = hostAndPort.lastIndexOf(":");
  if (colon === -1) return { hostname: hostAndPort };
  const port = hostAndPort.slice(colon + 1);
  if (!/^\d+$/u.test(port)) return null;
  return { hostname: hostAndPort.slice(0, colon), port };
}

function parseDatabaseUrl(value: string | undefined): ParsedDatabaseTarget {
  if (
    !value ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new UnsafeIntegrationTestDatabaseTargetError();
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new UnsafeIntegrationTestDatabaseTargetError();
  }

  if (
    (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
    parsed.hash !== "" ||
    !parsed.username ||
    !parsed.password
  ) {
    throw new UnsafeIntegrationTestDatabaseTargetError();
  }

  const rawEndpoint = getRawEndpoint(value);
  if (!rawEndpoint) {
    throw new UnsafeIntegrationTestDatabaseTargetError();
  }
  const host = normalizeLoopbackHost(rawEndpoint.hostname);
  if (!host || normalizeLoopbackHost(parsed.hostname) !== host) {
    throw new UnsafeIntegrationTestDatabaseTargetError();
  }

  const queryKeys = [...parsed.searchParams.keys()];
  if (
    queryKeys.some((key) => !SAFE_QUERY_PARAMETERS.has(key)) ||
    new Set(queryKeys).size !== queryKeys.length ||
    parsed.searchParams.getAll("schema").some((schema) => schema !== "public")
  ) {
    throw new UnsafeIntegrationTestDatabaseTargetError();
  }

  let database: string;
  let user: string;
  try {
    database = decodeURIComponent(parsed.pathname.slice(1));
    user = decodeURIComponent(parsed.username);
  } catch {
    throw new UnsafeIntegrationTestDatabaseTargetError();
  }

  const port = parsed.port ? Number(parsed.port) : 5432;
  if (
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    (rawEndpoint.port !== undefined && Number(rawEndpoint.port) !== port) ||
    !database ||
    !user
  ) {
    throw new UnsafeIntegrationTestDatabaseTargetError();
  }

  return {
    host,
    rawHost: rawEndpoint.hostname.toLowerCase().replace(/^\[|\]$/gu, ""),
    port,
    database,
    user,
  };
}

function matchesTarget(left: ParsedDatabaseTarget, right: ParsedDatabaseTarget): boolean {
  return (
    left.host === right.host &&
    left.port === right.port &&
    left.database === right.database
  );
}

export function resolveIsolatedIntegrationTestDatabaseTarget(
  environment: IntegrationTestDatabaseEnvironment,
): IntegrationTestDatabaseTarget {
  if (environment.nodeEnv === "production" || environment.vercel?.trim()) {
    throw new UnsafeIntegrationTestDatabaseTargetError();
  }

  const testTarget = parseDatabaseUrl(environment.testDatabaseUrl);
  const developmentTarget = parseDatabaseUrl(environment.developmentDatabaseUrl);
  const approvedTarget = APPROVED_INTEGRATION_TEST_TARGETS.find((target) =>
    testTarget.host === target.host &&
    testTarget.port === target.port &&
    testTarget.database === target.database &&
    testTarget.user === target.user &&
    (
      target.database === PHASE38_TEST_DATABASE_NAME ||
      testTarget.rawHost === INTEGRATION_TEST_DATABASE_HOST
    ),
  );

  if (!approvedTarget || matchesTarget(testTarget, developmentTarget)) {
    throw new UnsafeIntegrationTestDatabaseTargetError();
  }

  return approvedTarget;
}

export function assertIntegrationTestDatabaseServerIdentity(
  target: IntegrationTestDatabaseTarget,
  identity: IntegrationTestDatabaseServerIdentity,
): void {
  const serverHost = identity.serverAddress
    ? normalizeLoopbackHost(identity.serverAddress)
    : null;
  if (
    identity.databaseName !== target.database ||
    identity.userName !== target.user ||
    serverHost !== target.host ||
    identity.serverPort !== target.port
  ) {
    throw new UnsafeIntegrationTestDatabaseTargetError();
  }
}

export async function withVerifiedIntegrationTestDatabaseTarget<T>(
  environment: IntegrationTestDatabaseEnvironment,
  inspectServer: () => Promise<IntegrationTestDatabaseServerIdentity>,
  operation: (target: IntegrationTestDatabaseTarget) => Promise<T>,
): Promise<T> {
  const target = resolveIsolatedIntegrationTestDatabaseTarget(environment);

  let identity: IntegrationTestDatabaseServerIdentity;
  try {
    identity = await inspectServer();
  } catch {
    throw new UnsafeIntegrationTestDatabaseTargetError();
  }

  assertIntegrationTestDatabaseServerIdentity(target, identity);
  return operation(target);
}
