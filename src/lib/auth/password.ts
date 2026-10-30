import "server-only";

import {
  argon2id,
  hash as hashArgon2Password,
  verify as verifyArgon2Hash,
} from "argon2";

const ARGON2ID_HASH_PREFIX = "$argon2id$";
const ARGON2ID_HASH_OPTIONS = {
  type: argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
} as const;

export async function hashAdminPassword(password: string): Promise<string> {
  return hashArgon2Password(password, ARGON2ID_HASH_OPTIONS);
}

export async function verifyAdminPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  if (!passwordHash.startsWith(ARGON2ID_HASH_PREFIX)) {
    return false;
  }

  try {
    return await verifyArgon2Hash(passwordHash, password);
  } catch {
    // Treat malformed hashes as failed verification without logging secrets.
    return false;
  }
}
