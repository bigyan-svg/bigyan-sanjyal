export const MAX_DATABASE_INT = 2_147_483_647;

export function parseExpectedVersion(header: string | null): number | null {
  if (!header) return null;
  const match = /^"([1-9]\d{0,9})"$/u.exec(header);
  if (!match) return null;

  const version = Number(match[1]);
  return Number.isSafeInteger(version) && version <= MAX_DATABASE_INT
    ? version
    : null;
}

export function expectedVersionEntityTag(version: number): string {
  return `"${version}"`;
}
