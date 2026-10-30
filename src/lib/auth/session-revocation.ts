export interface AdminSessionRevocationStore {
  updateMany(args: {
    where: { id: string; revokedAt: null };
    data: { revokedAt: Date };
  }): Promise<{ count: number }>;
}

export async function revokeAdminSession(
  sessionId: string,
  store: AdminSessionRevocationStore,
  revokedAt = new Date(),
): Promise<number> {
  const result = await store.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt },
  });

  return result.count;
}
