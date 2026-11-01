import "server-only";

import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const RATE_LIMIT_TIMEOUT_MS = 1_000;
const RATE_LIMIT_HMAC_SECRET_MIN_BYTES = 32;

type RequestLimiters = {
  ipFifteenMinutes: Ratelimit;
  ipOneHour: Ratelimit;
  emailIpFifteenMinutes: Ratelimit;
  adminIpPasswordChangeFifteenMinutes: Ratelimit;
  contactIpFifteenMinutes: Ratelimit;
  contactIpOneHour: Ratelimit;
  hmacSecret: string;
};

export type AdminLoginRateLimitResult =
  | { status: "allowed" }
  | { status: "limited"; retryAfterSeconds: number }
  | { status: "unavailable" };

export type ContactRateLimitResult =
  | { status: "allowed" }
  | { status: "limited"; retryAfterSeconds: number }
  | { status: "unavailable" };

let cachedLimiters: RequestLimiters | undefined;

function getTrustedClientIp(request: Request): string | null {
  if (process.env.VERCEL === "1") {
    const forwardedIp = request.headers.get("x-vercel-forwarded-for")?.trim();

    if (!forwardedIp || forwardedIp.includes(",") || isIP(forwardedIp) === 0) {
      return null;
    }

    return forwardedIp;
  }

  if (
    process.env.NODE_ENV === "development" &&
    process.env.VERCEL !== "1" &&
    process.env.ENABLE_LOCAL_LOGIN_RATE_LIMIT === "true"
  ) {
    return "local-development";
  }

  return null;
}

function createLimiters(): RequestLimiters | null {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const hmacSecret = process.env.ADMIN_RATE_LIMIT_HMAC_SECRET;

  if (!redisUrl || !redisToken?.trim() || !hmacSecret) {
    return null;
  }

  if (Buffer.byteLength(hmacSecret, "utf8") < RATE_LIMIT_HMAC_SECRET_MIN_BYTES) {
    return null;
  }

  try {
    const parsedRedisUrl = new URL(redisUrl);

    if (
      parsedRedisUrl.protocol !== "https:" ||
      !parsedRedisUrl.hostname.endsWith(".upstash.io") ||
      parsedRedisUrl.username !== "" ||
      parsedRedisUrl.password !== "" ||
      parsedRedisUrl.search !== "" ||
      parsedRedisUrl.hash !== ""
    ) {
      return null;
    }
  } catch {
    return null;
  }

  const redis = new Redis({
    url: redisUrl,
    token: redisToken,
    enableTelemetry: false,
  });

  return {
    hmacSecret,
    ipFifteenMinutes: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, "15 m"),
      prefix: "admin-login:ip:15m",
      analytics: false,
      timeout: RATE_LIMIT_TIMEOUT_MS,
    }),
    ipOneHour: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(30, "1 h"),
      prefix: "admin-login:ip:1h",
      analytics: false,
      timeout: RATE_LIMIT_TIMEOUT_MS,
    }),
    emailIpFifteenMinutes: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, "15 m"),
      prefix: "admin-login:email-ip:15m",
      analytics: false,
      timeout: RATE_LIMIT_TIMEOUT_MS,
    }),
    adminIpPasswordChangeFifteenMinutes: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, "15 m"),
      prefix: "admin-password-change:admin-ip:15m",
      analytics: false,
      timeout: RATE_LIMIT_TIMEOUT_MS,
    }),
    contactIpFifteenMinutes: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, "15 m"),
      prefix: "contact-submit:ip:15m",
      analytics: false,
      timeout: RATE_LIMIT_TIMEOUT_MS,
    }),
    contactIpOneHour: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(20, "1 h"),
      prefix: "contact-submit:ip:1h",
      analytics: false,
      timeout: RATE_LIMIT_TIMEOUT_MS,
    }),
  };
}

function getLimiters(): RequestLimiters | null {
  if (cachedLimiters) {
    return cachedLimiters;
  }

  const limiters = createLimiters();

  if (limiters) {
    cachedLimiters = limiters;
  }

  return limiters;
}

function pseudonymousIdentifier(
  secret: string,
  scope: string,
  value: string,
): string {
  return createHmac("sha256", secret)
    .update(scope)
    .update("\0")
    .update(value)
    .digest("hex");
}

export async function checkAdminLoginRateLimit(
  request: Request,
  normalizedEmail: string,
): Promise<AdminLoginRateLimitResult> {
  const clientIp = getTrustedClientIp(request);

  if (!clientIp) {
    return { status: "unavailable" };
  }

  try {
    const limiters = getLimiters();

    if (!limiters) {
      return { status: "unavailable" };
    }

    const ipIdentifier = pseudonymousIdentifier(
      limiters.hmacSecret,
      "ip",
      clientIp,
    );
    const emailIpIdentifier = pseudonymousIdentifier(
      limiters.hmacSecret,
      "email-ip",
      `${normalizedEmail.trim().toLowerCase()}\0${clientIp}`,
    );

    const results = await Promise.all([
      limiters.ipFifteenMinutes.limit(ipIdentifier),
      limiters.ipOneHour.limit(ipIdentifier),
      limiters.emailIpFifteenMinutes.limit(emailIpIdentifier),
    ]);

    if (results.some((result) => result.reason === "timeout")) {
      return { status: "unavailable" };
    }

    const blockedResults = results.filter((result) => !result.success);

    if (blockedResults.length === 0) {
      return { status: "allowed" };
    }

    const nextAllowedAt = Math.max(...blockedResults.map((result) => result.reset));

    return {
      status: "limited",
      retryAfterSeconds: Math.max(1, Math.ceil((nextAllowedAt - Date.now()) / 1_000)),
    };
  } catch {
    return { status: "unavailable" };
  }
}

export async function checkAdminPasswordChangeRateLimit(
  request: Request,
  adminUserId: string,
): Promise<AdminLoginRateLimitResult> {
  const clientIp = getTrustedClientIp(request);

  if (!clientIp) {
    return { status: "unavailable" };
  }

  try {
    const limiters = getLimiters();

    if (!limiters) {
      return { status: "unavailable" };
    }

    const adminIpIdentifier = pseudonymousIdentifier(
      limiters.hmacSecret,
      "admin-ip-password-change",
      `${adminUserId}\0${clientIp}`,
    );
    const result = await limiters.adminIpPasswordChangeFifteenMinutes.limit(
      adminIpIdentifier,
    );

    if (result.reason === "timeout") {
      return { status: "unavailable" };
    }

    if (result.success) {
      return { status: "allowed" };
    }

    return {
      status: "limited",
      retryAfterSeconds: Math.max(1, Math.ceil((result.reset - Date.now()) / 1_000)),
    };
  } catch {
    return { status: "unavailable" };
  }
}

export async function checkContactSubmissionRateLimit(
  request: Request,
): Promise<ContactRateLimitResult> {
  const clientIp = getTrustedClientIp(request);

  if (!clientIp) {
    return { status: "unavailable" };
  }

  try {
    const limiters = getLimiters();

    if (!limiters) {
      return { status: "unavailable" };
    }

    const identifier = pseudonymousIdentifier(
      limiters.hmacSecret,
      "contact-ip",
      clientIp,
    );
    const results = await Promise.all([
      limiters.contactIpFifteenMinutes.limit(identifier),
      limiters.contactIpOneHour.limit(identifier),
    ]);

    if (results.some((result) => result.reason === "timeout")) {
      return { status: "unavailable" };
    }

    const blockedResults = results.filter((result) => !result.success);
    if (blockedResults.length === 0) {
      return { status: "allowed" };
    }

    const nextAllowedAt = Math.max(...blockedResults.map((result) => result.reset));
    return {
      status: "limited",
      retryAfterSeconds: Math.max(1, Math.ceil((nextAllowedAt - Date.now()) / 1_000)),
    };
  } catch {
    return { status: "unavailable" };
  }
}
