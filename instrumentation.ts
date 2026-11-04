import { getRateLimitReadiness } from "./src/lib/auth/rate-limit-readiness";

export function register() {
  if (
    process.env.NEXT_RUNTIME !== "nodejs" ||
    (process.env.NODE_ENV !== "production" &&
      process.env.NODE_ENV !== "development")
  ) {
    return;
  }

  const readiness = getRateLimitReadiness(process.env);

  console.info(
    "[rate-limit-readiness]",
    JSON.stringify({
      environment: readiness.environment,
      trustedClientIpPolicy: readiness.trustedClientIpPolicy,
      trustedClientIpSourceConfigured: readiness.trustedClientIpSourceConfigured,
      redisUrlConfigured: readiness.redisUrlConfigured,
      redisUrlValid: readiness.redisUrlValid,
      redisTokenConfigured: readiness.redisTokenConfigured,
      hmacSecretConfigured: readiness.hmacSecretConfigured,
      hmacSecretStrong: readiness.hmacSecretStrong,
      ready: readiness.ready,
      issues: readiness.issues,
    }),
  );
}
