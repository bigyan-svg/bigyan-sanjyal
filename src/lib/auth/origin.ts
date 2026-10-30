import "server-only";

const LOCAL_DEVELOPMENT_ORIGIN = "http://localhost:3000";

function normalizeOrigin(value: string, requireSerializedOrigin: boolean): string | null {
  try {
    const url = new URL(value);

    if (
      url.origin === "null" ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return null;
    }

    if (requireSerializedOrigin && value !== url.origin) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

function getTrustedOrigin(): string | null {
  if (
    process.env.NODE_ENV === "development" &&
    process.env.VERCEL !== "1"
  ) {
    return LOCAL_DEVELOPMENT_ORIGIN;
  }

  const configuredOrigin = process.env.AUTH_TRUSTED_ORIGIN;

  if (!configuredOrigin) {
    return null;
  }

  const normalizedOrigin = normalizeOrigin(configuredOrigin, false);

  if (!normalizedOrigin || new URL(normalizedOrigin).protocol !== "https:") {
    return null;
  }

  return normalizedOrigin;
}

export function hasTrustedRequestOrigin(request: Request): boolean {
  const originHeader = request.headers.get("origin");

  if (!originHeader) {
    return false;
  }

  const requestOrigin = normalizeOrigin(originHeader, true);
  const trustedOrigin = getTrustedOrigin();

  return requestOrigin !== null && trustedOrigin !== null && requestOrigin === trustedOrigin;
}
