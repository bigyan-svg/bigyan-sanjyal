export interface PasswordChangeTimestampComparison {
  isNewer: boolean;
  isEqual: boolean;
  sessionCreatedAt: string;
  passwordChangedAt: string;
}

/** Compare PostgreSQL epoch microseconds without losing TIMESTAMPTZ(6) precision. */
export function compareSessionPasswordChangeTimestamps(
  sessionCreatedAtEpochMicros: string,
  passwordChangedAtEpochMicros: string,
  sessionCreatedAt: string,
  passwordChangedAt: string,
): PasswordChangeTimestampComparison | null {
  if (
    !/^-?\d+$/u.test(sessionCreatedAtEpochMicros) ||
    !/^-?\d+$/u.test(passwordChangedAtEpochMicros)
  ) {
    return null;
  }

  const createdAt = BigInt(sessionCreatedAtEpochMicros);
  const changedAt = BigInt(passwordChangedAtEpochMicros);

  return {
    isNewer: createdAt > changedAt,
    isEqual: createdAt === changedAt,
    sessionCreatedAt,
    passwordChangedAt,
  };
}
