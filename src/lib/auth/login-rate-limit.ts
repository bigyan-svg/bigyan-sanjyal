import "server-only";

import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import {
  getRateLimitReadiness,
  type RateLimitEnvironment,
} from "./rate-limit-readiness";

const RATE_LIMIT_TIMEOUT_MS = 1_000;
const LOCAL_LOGIN_RATE_LIMIT_HMAC_SECRET = randomBytes(32).toString("hex");

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

const LOCAL_LOGIN_RATE_LIMIT_WINDOWS = [
  {
    name: "ipFifteenMinutes",
    limit: ADMIN_RATE_LIMIT_POLICIES.adminLoginIpFifteenMinutes.limit,
    windowMs: 15 * 60 * 1_000,
    identifier: "ip",
  },
  {
    name: "ipOneHour",
    limit: ADMIN_RATE_LIMIT_POLICIES.adminLoginIpOneHour.limit,
    windowMs: 60 * 60 * 1_000,
    identifier: "ip",
  },
  {
    name: "emailIpFifteenMinutes",
    limit: ADMIN_RATE_LIMIT_POLICIES.adminLoginEmailIpFifteenMinutes.limit,
    windowMs: 15 * 60 * 1_000,
    identifier: "email-ip",
  },
  {
    name: "emailFifteenMinutes",
    limit: ADMIN_RATE_LIMIT_POLICIES.adminLoginEmailFifteenMinutes.limit,
    windowMs: 15 * 60 * 1_000,
    identifier: "email",
  },
  {
    name: "emailOneHour",
    limit: ADMIN_RATE_LIMIT_POLICIES.adminLoginEmailOneHour.limit,
    windowMs: 60 * 60 * 1_000,
    identifier: "email",
  },
] as const;
const MAX_LOCAL_LOGIN_RATE_LIMIT_ACCOUNTS = 1_000;

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
  | {
      status: "unavailable";
      reason:
        | "trusted_ip_missing"
        | "redis_configuration_missing"
        | "redis_url_invalid"
        | "admin_hmac_secret_invalid"
        | "redis_timeout"
        | "redis_connection_error"
        | "redis_command_error";
    };

export type AdminLoginUnavailableReason =
  Extract<AdminLoginRateLimitResult, { status: "unavailable" }>["reason"];

type RateLimitDecision = {
  success: boolean;
  reset: number;
  reason?: string;
};

type LoginRateLimiter = {
  limit(identifier: string): Promise<RateLimitDecision>;
};

type LocalRateLimitWindow = {
  timestamps: number[];
  windowMs: number;
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
  | {
      status: "unavailable";
      reason: AdminLoginUnavailableReason;
    };

let cachedLimiters: RequestLimiters | undefined;

function isLocalDevelopmentLoginRateLimitEnabled(
  environment: RateLimitEnvironment,
): boolean {
  return (
    environment.NODE_ENV === "development" &&
    environment.VERCEL !== "1" &&
    !environment.VERCEL_ENV
  );
}

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

export class ProcessLocalLoginRateLimiter {
  private readonly sharedWindows = new Map<string, LocalRateLimitWindow>();
  private readonly accountWindows = new Map<
    string,
    Map<string, LocalRateLimitWindow>
  >();

  constructor(
    private readonly hmacSecret: string,
    private readonly maxAccounts = MAX_LOCAL_LOGIN_RATE_LIMIT_ACCOUNTS,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isSafeInteger(maxAccounts) || maxAccounts < 1) {
      throw new RangeError("The local login rate-limit account capacity must be positive.");
    }
  }

  limit(email: string): AdminLoginRateLimitResult {
    const now = this.now();
    this.pruneExpiredWindows(now);

    const sharedResults = LOCAL_LOGIN_RATE_LIMIT_WINDOWS
      .filter((window) => window.identifier === "ip")
      .map((window) =>
        this.checkWindow(
          this.sharedWindows,
          window.name,
          window.limit,
          window.windowMs,
          now,
        ),
      );
    const blockedSharedResults = sharedResults.filter((result) => !result.success);
    if (blockedSharedResults.length > 0) {
      return this.limitedResult(blockedSharedResults, now);
    }

    const normalizedEmail = email.trim().toLowerCase();
    const accountKey = createAdminLoginEmailPseudonym(
      this.hmacSecret,
      normalizedEmail,
    );
    let accountWindows = this.accountWindows.get(accountKey);

    if (!accountWindows && this.accountWindows.size >= this.maxAccounts) {
      return {
        status: "limited",
        retryAfterSeconds: this.nextAccountSlotRetryAfter(now),
      };
    }

    if (!accountWindows) {
      accountWindows = new Map();
      this.accountWindows.set(accountKey, accountWindows);
    }

    const accountResults = LOCAL_LOGIN_RATE_LIMIT_WINDOWS
      .filter((window) => window.identifier !== "ip")
      .map((window) =>
        this.checkWindow(
          accountWindows,
          window.name,
          window.limit,
          window.windowMs,
          now,
        ),
      );
    const blockedAccountResults = accountResults.filter((result) => !result.success);

    return blockedAccountResults.length > 0
      ? this.limitedResult(blockedAccountResults, now)
      : { status: "allowed" };
  }

  private checkWindow(
    windows: Map<string, LocalRateLimitWindow>,
    name: string,
    limit: number,
    windowMs: number,
    now: number,
  ): RateLimitDecision {
    const storedWindow = windows.get(name) ?? { timestamps: [], windowMs };
    const reset = (storedWindow.timestamps[0] ?? now) + windowMs;

    if (storedWindow.timestamps.length >= limit) {
      return { success: false, reset };
    }

    storedWindow.timestamps.push(now);
    windows.set(name, storedWindow);
    return { success: true, reset: now + windowMs };
  }

  private pruneExpiredWindows(now: number): void {
    for (const [name, window] of this.sharedWindows) {
      window.timestamps = window.timestamps.filter(
        (timestamp) => timestamp > now - window.windowMs,
      );
      if (window.timestamps.length === 0) this.sharedWindows.delete(name);
    }

    for (const [accountKey, windows] of this.accountWindows) {
      for (const [name, window] of windows) {
        window.timestamps = window.timestamps.filter(
          (timestamp) => timestamp > now - window.windowMs,
        );
        if (window.timestamps.length === 0) windows.delete(name);
      }
      if (windows.size === 0) this.accountWindows.delete(accountKey);
    }
  }

  private nextAccountSlotRetryAfter(now: number): number {
    let nextAvailableAt = Number.POSITIVE_INFINITY;

    for (const windows of this.accountWindows.values()) {
      let accountAvailableAt = Number.NEGATIVE_INFINITY;
      for (const window of windows.values()) {
        const latestTimestamp = Math.max(...window.timestamps);
        accountAvailableAt = Math.max(
          accountAvailableAt,
          latestTimestamp + window.windowMs,
        );
      }
      nextAvailableAt = Math.min(nextAvailableAt, accountAvailableAt);
    }

    return Math.max(1, Math.ceil((nextAvailableAt - now) / 1_000));
  }

  private limitedResult(
    blockedResults: readonly RateLimitDecision[],
    now: number,
  ): AdminLoginRateLimitResult {
    const nextAllowedAt = Math.max(...blockedResults.map((result) => result.reset));
    return {
      status: "limited",
      retryAfterSeconds: Math.max(1, Math.ceil((nextAllowedAt - now) / 1_000)),
    };
  }
}

const localDevelopmentLoginRateLimiter = new ProcessLocalLoginRateLimiter(
  LOCAL_LOGIN_RATE_LIMIT_HMAC_SECRET,
);

export async function checkAdminLoginRateLimit(
  request: Request,
  normalizedEmail: string,
  backend?: AdminLoginRateLimitBackend,
): Promise<AdminLoginRateLimitResult> {
  if (isLocalDevelopmentLoginRateLimitEnabled(process.env)) {
    return localDevelopmentLoginRateLimiter.limit(normalizedEmail);
  }

  const clientIp = getTrustedClientIp(request);

  if (!clientIp) {
    return { status: "unavailable", reason: "trusted_ip_missing" };
  }

  try {
    const limiters = backend ?? getLimiters();

    if (!limiters) {
      const readiness = getRateLimitReadiness(process.env);
      if (!readiness.redisConfigurationReady) {
        const configurationMissing =
          !readiness.redisUrlConfigured ||
          !readiness.redisTokenConfigured ||
          !readiness.hmacSecretConfigured;
        return {
          status: "unavailable",
          reason: configurationMissing
            ? "redis_configuration_missing"
            : !readiness.redisUrlValid
              ? "redis_url_invalid"
              : "admin_hmac_secret_invalid",
        };
      }
      return { status: "unavailable", reason: "redis_connection_error" };
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
      return { status: "unavailable", reason: "redis_timeout" };
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
  } catch (error) {
    return {
      status: "unavailable",
      reason: classifyRedisFailure(error),
    };
  }
}

function classifyRedisFailure(error: unknown): AdminLoginUnavailableReason {
  const timeoutCodes = new Set(["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"]);
  const connectionCodes = new Set([
    "ECONNREFUSED",
    "ECONNRESET",
    "ENOTFOUND",
    "EAI_AGAIN",
    "ENETUNREACH",
    "EHOSTUNREACH",
    "EPIPE",
  ]);
  const visited = new Set<object>();
  const names: string[] = [];
  const codes: string[] = [];
  let current: unknown = error;

  for (let depth = 0; depth < 8 && typeof current === "object" && current !== null; depth++) {
    if (visited.has(current)) break;
    visited.add(current);

    const classifiedError = current as {
      name?: unknown;
      code?: unknown;
      cause?: unknown;
    };
    const name = typeof classifiedError.name === "string"
      ? classifiedError.name.toLowerCase()
      : "";
    const code = typeof classifiedError.code === "string"
      ? classifiedError.code.toUpperCase()
      : "";
    if (name) names.push(name);
    if (code) codes.push(code);
    current = classifiedError.cause;
  }

  if (
    names.some((name) => name.includes("timeout")) ||
    codes.some((code) => timeoutCodes.has(code))
  ) {
    return "redis_timeout";
  }

  if (
    codes.some((code) => connectionCodes.has(code)) ||
    names.some((name) => name.includes("connection"))
  ) {
    return "redis_connection_error";
  }

  return "redis_command_error";
}

export async function checkAdminPasswordChangeRateLimit(
  request: Request,
  adminUserId: string,
): Promise<AdminLoginRateLimitResult> {
  const clientIp = getTrustedClientIp(request);

  if (!clientIp) {
    return { status: "unavailable", reason: "trusted_ip_missing" };
  }

  try {
    const limiters = getLimiters();

    if (!limiters) {
      return { status: "unavailable", reason: getRedisConfigurationUnavailableReason() };
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
      return { status: "unavailable", reason: "redis_timeout" };
    }

    if (result.success) {
      return { status: "allowed" };
    }

    return {
      status: "limited",
      retryAfterSeconds: Math.max(1, Math.ceil((result.reset - Date.now()) / 1_000)),
    };
  } catch (error) {
    return { status: "unavailable", reason: classifyRedisFailure(error) };
  }
}

export async function checkContactSubmissionRateLimit(
  request: Request,
): Promise<ContactRateLimitResult> {
  const clientIp = getTrustedClientIp(request);

  if (!clientIp) {
    return { status: "unavailable", reason: "trusted_ip_missing" };
  }

  try {
    const limiters = getLimiters();

    if (!limiters) {
      return { status: "unavailable", reason: getRedisConfigurationUnavailableReason() };
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
      return { status: "unavailable", reason: "redis_timeout" };
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
  } catch (error) {
    return { status: "unavailable", reason: classifyRedisFailure(error) };
  }
}

function getRedisConfigurationUnavailableReason(): AdminLoginUnavailableReason {
  const readiness = getRateLimitReadiness(process.env);
  const missing =
    !readiness.redisUrlConfigured ||
    !readiness.redisTokenConfigured ||
    !readiness.hmacSecretConfigured;
  if (missing) return "redis_configuration_missing";
  if (!readiness.redisUrlValid) return "redis_url_invalid";
  return "admin_hmac_secret_invalid";
}
