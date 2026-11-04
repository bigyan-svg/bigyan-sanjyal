import "server-only";

import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import {
  getRateLimitReadiness,
  type RateLimitEnvironment,
} from "./rate-limit-readiness";

const RATE_LIMIT_TIMEOUT_MS = 1_000;

export const ADMIN_RATE_LIMIT_POLICIES = {
  adminLoginIpFifteenMinutes: {
    limit: 10,
    window: "15 m",
    prefix: "admin-login:ip:15m",
  },
  adminLoginIpOneHour: {
    limit: 30,
    window: "1 h",
    prefix: "admin-login:ip:1h",
  },
  adminLoginEmailIpFifteenMinutes: {
    limit: 10,
    window: "15 m",
    prefix: "admin-login:email-ip:15m",
  },
  adminLoginEmailFifteenMinutes: {
    limit: 10,
    window: "15 m",
    prefix: "admin-login:email:15m",
  },
  adminLoginEmailOneHour: {
    limit: 30,
    window: "1 h",
    prefix: "admin-login:email:1h",
  },
  adminPasswordChangeIpFifteenMinutes: {
    limit: 5,
    window: "15 m",
    prefix: "admin-password-change:admin-ip:15m",
  },
  contactIpFifteenMinutes: {
    limit: 5,
    window: "15 m",
    prefix: "contact-submit:ip:15m",
  },
  contactIpOneHour: {
    limit: 20,
    window: "1 h",
    prefix: "contact-submit:ip:1h",
  },
} as const;

type RequestLimiters = {
  ipFifteenMinutes: Ratelimit;
  ipOneHour: Ratelimit;
  emailIpFifteenMinutes: Ratelimit;
  emailFifteenMinutes: Ratelimit;
  emailOneHour: Ratelimit;
  adminIpPasswordChangeFifteenMinutes: Ratelimit;
  contactIpFifteenMinutes: Ratelimit;
  contactIpOneHour: Ratelimit;
  hmacSecret: string;
};

export type AdminLoginRateLimitResult =
  | { status: "allowed" }
  | { status: "limited"; retryAfterSeconds: number }
  | { status: "unavailable" };

type RateLimitDecision = {
  success: boolean;
  reset: number;
  reason?: string;
};

type LoginRateLimiter = {
  limit(identifier: string): Promise<RateLimitDecision>;
};

export type AdminLoginRateLimitBackend = {
  hmacSecret: string;
  ipFifteenMinutes: LoginRateLimiter;
  ipOneHour: LoginRateLimiter;
  emailIpFifteenMinutes: LoginRateLimiter;
  emailFifteenMinutes: LoginRateLimiter;
  emailOneHour: LoginRateLimiter;
};

export type ContactRateLimitResult =
  | { status: "allowed" }
  | { status: "limited"; retryAfterSeconds: number }
  | { status: "unavailable" };

let cachedLimiters: RequestLimiters | undefined;

export function getTrustedClientIp(
  request: Request,
  environment: RateLimitEnvironment = process.env,
): string | null {
  if (environment.VERCEL === "1") {
    // Trust only Vercel's edge-provided value; never fall back to generic proxy headers.
    const forwardedIp = request.headers.get("x-vercel-forwarded-for")?.trim();

    if (!forwardedIp || forwardedIp.includes(",") || isIP(forwardedIp) === 0) {
      return null;
    }

    return forwardedIp;
  }

  if (
    environment.NODE_ENV === "development" &&
    environment.VERCEL !== "1" &&
    environment.ENABLE_LOCAL_LOGIN_RATE_LIMIT === "true"
  ) {
    return "local-development";
  }

  return null;
}

function createLimiters(): RequestLimiters | null {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const hmacSecret = process.env.ADMIN_RATE_LIMIT_HMAC_SECRET;

  if (!getRateLimitReadiness(process.env).redisConfigurationReady) {
    return null;
  }

  if (!redisUrl || !redisToken?.trim() || !hmacSecret) return null;

  const redis = new Redis({
    url: redisUrl,
    token: redisToken,
    enableTelemetry: false,
  });

  return {
    hmacSecret,
    ipFifteenMinutes: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        ADMIN_RATE_LIMIT_POLICIES.adminLoginIpFifteenMinutes.limit,
        ADMIN_RATE_LIMIT_POLICIES.adminLoginIpFifteenMinutes.window,
      ),
      prefix: ADMIN_RATE_LIMIT_POLICIES.adminLoginIpFifteenMinutes.prefix,
      analytics: false,
      timeout: RATE_LIMIT_TIMEOUT_MS,
    }),
    ipOneHour: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        ADMIN_RATE_LIMIT_POLICIES.adminLoginIpOneHour.limit,
        ADMIN_RATE_LIMIT_POLICIES.adminLoginIpOneHour.window,
      ),
      prefix: ADMIN_RATE_LIMIT_POLICIES.adminLoginIpOneHour.prefix,
      analytics: false,
      timeout: RATE_LIMIT_TIMEOUT_MS,
    }),
    emailIpFifteenMinutes: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        ADMIN_RATE_LIMIT_POLICIES.adminLoginEmailIpFifteenMinutes.limit,
        ADMIN_RATE_LIMIT_POLICIES.adminLoginEmailIpFifteenMinutes.window,
      ),
      prefix: ADMIN_RATE_LIMIT_POLICIES.adminLoginEmailIpFifteenMinutes.prefix,
      analytics: false,
      timeout: RATE_LIMIT_TIMEOUT_MS,
    }),
    emailFifteenMinutes: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        ADMIN_RATE_LIMIT_POLICIES.adminLoginEmailFifteenMinutes.limit,
        ADMIN_RATE_LIMIT_POLICIES.adminLoginEmailFifteenMinutes.window,
      ),
      prefix: ADMIN_RATE_LIMIT_POLICIES.adminLoginEmailFifteenMinutes.prefix,
      analytics: false,
      timeout: RATE_LIMIT_TIMEOUT_MS,
    }),
    emailOneHour: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        ADMIN_RATE_LIMIT_POLICIES.adminLoginEmailOneHour.limit,
        ADMIN_RATE_LIMIT_POLICIES.adminLoginEmailOneHour.window,
      ),
      prefix: ADMIN_RATE_LIMIT_POLICIES.adminLoginEmailOneHour.prefix,
      analytics: false,
      timeout: RATE_LIMIT_TIMEOUT_MS,
    }),
    adminIpPasswordChangeFifteenMinutes: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        ADMIN_RATE_LIMIT_POLICIES.adminPasswordChangeIpFifteenMinutes.limit,
        ADMIN_RATE_LIMIT_POLICIES.adminPasswordChangeIpFifteenMinutes.window,
      ),
      prefix: ADMIN_RATE_LIMIT_POLICIES.adminPasswordChangeIpFifteenMinutes.prefix,
      analytics: false,
      timeout: RATE_LIMIT_TIMEOUT_MS,
    }),
    contactIpFifteenMinutes: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        ADMIN_RATE_LIMIT_POLICIES.contactIpFifteenMinutes.limit,
        ADMIN_RATE_LIMIT_POLICIES.contactIpFifteenMinutes.window,
      ),
      prefix: ADMIN_RATE_LIMIT_POLICIES.contactIpFifteenMinutes.prefix,
      analytics: false,
      timeout: RATE_LIMIT_TIMEOUT_MS,
    }),
    contactIpOneHour: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        ADMIN_RATE_LIMIT_POLICIES.contactIpOneHour.limit,
        ADMIN_RATE_LIMIT_POLICIES.contactIpOneHour.window,
      ),
      prefix: ADMIN_RATE_LIMIT_POLICIES.contactIpOneHour.prefix,
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

export function createRateLimitPseudonym(
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

export function createAdminLoginEmailPseudonym(
  secret: string,
  email: string,
): string {
  return createRateLimitPseudonym(secret, "email", email.trim().toLowerCase());
}

export async function checkAdminLoginRateLimit(
  request: Request,
  normalizedEmail: string,
  backend?: AdminLoginRateLimitBackend,
): Promise<AdminLoginRateLimitResult> {
  const clientIp = getTrustedClientIp(request);

  if (!clientIp) {
    return { status: "unavailable" };
  }

  try {
    const limiters = backend ?? getLimiters();

    if (!limiters) {
      return { status: "unavailable" };
    }

    const ipIdentifier = createRateLimitPseudonym(
      limiters.hmacSecret,
      "ip",
      clientIp,
    );
    const emailIpIdentifier = createRateLimitPseudonym(
      limiters.hmacSecret,
      "email-ip",
      `${normalizedEmail.trim().toLowerCase()}\0${clientIp}`,
    );
    const emailIdentifier = createAdminLoginEmailPseudonym(
      limiters.hmacSecret,
      normalizedEmail,
    );

    const results = await Promise.all([
      limiters.ipFifteenMinutes.limit(ipIdentifier),
      limiters.ipOneHour.limit(ipIdentifier),
      limiters.emailIpFifteenMinutes.limit(emailIpIdentifier),
      limiters.emailFifteenMinutes.limit(emailIdentifier),
      limiters.emailOneHour.limit(emailIdentifier),
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

    const adminIpIdentifier = createRateLimitPseudonym(
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

    const identifier = createRateLimitPseudonym(
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
