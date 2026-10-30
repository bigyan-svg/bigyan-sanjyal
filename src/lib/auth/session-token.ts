import "server-only";

import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const SESSION_TOKEN_BYTES = 32;
const DEVELOPMENT_TOKEN_TAG_BYTES = 16;
const DEVELOPMENT_TOKEN_BYTES = SESSION_TOKEN_BYTES + DEVELOPMENT_TOKEN_TAG_BYTES;

// Preserve the key through Next.js hot reloads; a dev-server process restart replaces it.
type SessionTokenGlobal = typeof globalThis & {
  __bigyanAdminSessionDevelopmentKey?: Uint8Array;
};

function getDevelopmentSessionKey(): Uint8Array {
  const globalWithSessionKey = globalThis as SessionTokenGlobal;

  globalWithSessionKey.__bigyanAdminSessionDevelopmentKey ??= randomBytes(32);

  return globalWithSessionKey.__bigyanAdminSessionDevelopmentKey;
}

function generateDevelopmentSessionToken(): string {
  const randomPart = randomBytes(SESSION_TOKEN_BYTES);
  const authenticationTag = createHmac("sha256", getDevelopmentSessionKey())
    .update(randomPart)
    .digest()
    .subarray(0, DEVELOPMENT_TOKEN_TAG_BYTES);

  return Buffer.concat([randomPart, authenticationTag]).toString("base64url");
}

export function generateSessionToken(): string {
  if (process.env.NODE_ENV === "development") {
    return generateDevelopmentSessionToken();
  }

  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

export function isCurrentDevelopmentSessionToken(token: string): boolean {
  const tokenBytes = Buffer.from(token, "base64url");

  if (
    tokenBytes.byteLength !== DEVELOPMENT_TOKEN_BYTES ||
    tokenBytes.toString("base64url") !== token
  ) {
    return false;
  }

  const randomPart = tokenBytes.subarray(0, SESSION_TOKEN_BYTES);
  const actualTag = tokenBytes.subarray(SESSION_TOKEN_BYTES);
  const expectedTag = createHmac("sha256", getDevelopmentSessionKey())
    .update(randomPart)
    .digest()
    .subarray(0, DEVELOPMENT_TOKEN_TAG_BYTES);

  return timingSafeEqual(actualTag, expectedTag);
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
