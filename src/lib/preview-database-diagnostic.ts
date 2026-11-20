export interface PreviewDatabaseIdentity {
  currentDatabase: string;
  currentUser: string;
  serverAddress: string | null;
  serverPort: number | null;
  transactionReadOnly: boolean;
}

export interface PreviewDatabaseMigrationCounts {
  migrationCount: bigint;
  completedMigrationCount: bigint;
  rolledBackMigrationCount: bigint;
}

export interface PreviewDatabaseDiagnosticQueries {
  getDatabaseIdentity(): Promise<PreviewDatabaseIdentity>;
  migrationMetadataTableExists(): Promise<boolean>;
  getMigrationCounts(): Promise<PreviewDatabaseMigrationCounts>;
}

export interface PreviewDatabaseDiagnostic {
  currentDatabase: string;
  currentUser: string;
  serverAddress: string | null;
  serverPort: number | null;
  transactionReadOnly: true;
  migrationMetadataTableExists: boolean;
  migrationCount: number | null;
  completedMigrationCount: number | null;
  rolledBackMigrationCount: number | null;
}

export interface PreviewDatabaseDiagnosticDependencies {
  isPreview: boolean;
  executeReadOnly(request: Request): Promise<Response | PreviewDatabaseDiagnostic>;
  logFailure(): void;
}

export interface ReadOnlyPreviewDiagnosticTransactionSteps<Result> {
  setTransactionReadOnly(): Promise<unknown>;
  authorize(): Promise<Response | null>;
  collect(): Promise<Result>;
}

const noStoreHeaders = { "Cache-Control": "no-store" };

function toSafeCount(value: bigint): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Invalid migration count.");
  }
  return count;
}

export async function collectPreviewDatabaseDiagnostic(
  queries: PreviewDatabaseDiagnosticQueries,
): Promise<PreviewDatabaseDiagnostic> {
  const identity = await queries.getDatabaseIdentity();
  if (!identity.transactionReadOnly) {
    throw new Error("The database transaction is not read-only.");
  }

  const migrationMetadataTableExists = await queries.migrationMetadataTableExists();
  const migrationCounts = migrationMetadataTableExists
    ? await queries.getMigrationCounts()
    : null;

  return {
    currentDatabase: identity.currentDatabase,
    currentUser: identity.currentUser,
    serverAddress: identity.serverAddress,
    serverPort: identity.serverPort,
    transactionReadOnly: true,
    migrationMetadataTableExists,
    migrationCount: migrationCounts ? toSafeCount(migrationCounts.migrationCount) : null,
    completedMigrationCount: migrationCounts
      ? toSafeCount(migrationCounts.completedMigrationCount)
      : null,
    rolledBackMigrationCount: migrationCounts
      ? toSafeCount(migrationCounts.rolledBackMigrationCount)
      : null,
  };
}

export async function runPreviewDatabaseDiagnosticInReadOnlyTransaction<Result>(
  steps: ReadOnlyPreviewDiagnosticTransactionSteps<Result>,
): Promise<Response | Result> {
  await steps.setTransactionReadOnly();
  const authorizationError = await steps.authorize();
  if (authorizationError) return authorizationError;
  return steps.collect();
}

export async function handlePreviewDatabaseDiagnosticRequest(
  request: Request,
  dependencies: PreviewDatabaseDiagnosticDependencies,
): Promise<Response> {
  if (!dependencies.isPreview) {
    return Response.json(
      { error: "Not found." },
      { status: 404, headers: noStoreHeaders },
    );
  }

  try {
    const result = await dependencies.executeReadOnly(request);
    if (result instanceof Response) return result;
    return Response.json(result, { headers: noStoreHeaders });
  } catch {
    dependencies.logFailure();
    return Response.json(
      { error: "Database diagnostic unavailable." },
      { status: 503, headers: noStoreHeaders },
    );
  }
}
