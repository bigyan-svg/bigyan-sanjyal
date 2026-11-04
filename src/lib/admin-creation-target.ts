export interface AdminCreationTarget {
  confirmation: string;
  display: string;
}

const OVERRIDE_QUERY_PARAMETERS = new Set([
  "database",
  "host",
  "password",
  "port",
  "user",
]);

export function getAdminCreationTarget(
  databaseUrl: string | undefined,
): AdminCreationTarget | null {
  if (!databaseUrl || databaseUrl !== databaseUrl.trim()) return null;

  try {
    const parsed = new URL(databaseUrl);
    if (
      (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
      parsed.hostname === "" ||
      parsed.hash !== "" ||
      [...parsed.searchParams.keys()].some((key) =>
        OVERRIDE_QUERY_PARAMETERS.has(key.toLowerCase()),
      )
    ) {
      return null;
    }

    const database = decodeURIComponent(parsed.pathname.slice(1));
    if (!database || /[\u0000-\u001f\u007f]/u.test(database)) return null;

    const host = parsed.hostname.includes(":")
      ? `[${parsed.hostname}]`
      : parsed.hostname;
    const display = `${host}:${parsed.port || "5432"}/${encodeURIComponent(database)}`;

    return { confirmation: display, display };
  } catch {
    return null;
  }
}
