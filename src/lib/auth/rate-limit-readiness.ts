export type RateLimitEnvironment = Readonly<{
  NODE_ENV?: string;
  VERCEL?: string;
  VERCEL_ENV?: string;
  ENABLE_LOCAL_LOGIN_RATE_LIMIT?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
  ADMIN_RATE_LIMIT_HMAC_SECRET?: string;
}>;

export type RateLimitReadiness = Readonly<{
  environment: "production" | "development" | "other";
  loginRateLimitBackend: "process-local" | "upstash" | "unavailable";
  loginReady: boolean;
  trustedClientIpPolicy:
    | "vercel-edge-direct-ingress-only"
    | "local-development"
    | "unavailable";
  trustedClientIpSourceConfigured: boolean;
  redisUrlConfigured: boolean;
  redisUrlValid: boolean;
  redisTokenConfigured: boolean;
  hmacSecretConfigured: boolean;
  hmacSecretStrong: boolean;
  redisConfigurationReady: boolean;
  ready: boolean;
  issues: readonly string[];
}>;

const HMAC_SECRET_MIN_BYTES = 32;

function isValidUpstashUrl(value: string | undefined): boolean {
  if (!value) return false;

  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.endsWith(".upstash.io") &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.search === "" &&
      parsed.hash === ""
    );
  } catch {
    return false;
  }
}

export function getRateLimitReadiness(
  environment: RateLimitEnvironment,
): RateLimitReadiness {
  const deploymentEnvironment =
    environment.NODE_ENV === "production"
      ? "production"
      : environment.NODE_ENV === "development"
        ? "development"
        : "other";
  const trustedClientIpPolicy =
    environment.VERCEL === "1"
      ? "vercel-edge-direct-ingress-only"
      : deploymentEnvironment === "development" &&
          environment.ENABLE_LOCAL_LOGIN_RATE_LIMIT === "true"
        ? "local-development"
        : "unavailable";
  const redisUrlConfigured = Boolean(environment.UPSTASH_REDIS_REST_URL);
  const redisUrlValid = isValidUpstashUrl(environment.UPSTASH_REDIS_REST_URL);
  const redisTokenConfigured = Boolean(environment.UPSTASH_REDIS_REST_TOKEN?.trim());
  const hmacSecret = environment.ADMIN_RATE_LIMIT_HMAC_SECRET;
  const hmacSecretConfigured = Boolean(hmacSecret);
  const hmacSecretStrong =
    hmacSecret !== undefined &&
    new TextEncoder().encode(hmacSecret).byteLength >= HMAC_SECRET_MIN_BYTES;
  const redisConfigurationReady =
    redisUrlValid && redisTokenConfigured && hmacSecretStrong;
  const trustedClientIpSourceConfigured = trustedClientIpPolicy !== "unavailable";
  const localLoginRateLimitEnabled =
    deploymentEnvironment === "development" &&
    environment.VERCEL !== "1" &&
    !environment.VERCEL_ENV;
  const loginRateLimitBackend = localLoginRateLimitEnabled
    ? "process-local"
    : trustedClientIpSourceConfigured && redisConfigurationReady
      ? "upstash"
      : "unavailable";

  const issues: string[] = [];
  if (!trustedClientIpSourceConfigured) {
    issues.push(
      deploymentEnvironment === "production"
        ? "unsupported-production-proxy"
        : "trusted-client-ip-source-unavailable",
    );
  }
  if (!redisUrlConfigured) issues.push("upstash-url-missing");
  else if (!redisUrlValid) issues.push("upstash-url-invalid");
  if (!redisTokenConfigured) issues.push("upstash-token-missing");
  if (!hmacSecretConfigured) issues.push("hmac-secret-missing");
  else if (!hmacSecretStrong) issues.push("hmac-secret-too-short");

  return {
    environment: deploymentEnvironment,
    loginRateLimitBackend,
    loginReady: loginRateLimitBackend !== "unavailable",
    trustedClientIpPolicy,
    trustedClientIpSourceConfigured,
    redisUrlConfigured,
    redisUrlValid,
    redisTokenConfigured,
    hmacSecretConfigured,
    hmacSecretStrong,
    redisConfigurationReady,
    ready: trustedClientIpSourceConfigured && redisConfigurationReady,
    issues,
  };
}
