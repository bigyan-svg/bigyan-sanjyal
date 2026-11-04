export type AdminLoginNavigationResult = "navigated" | "rejected";

/** Require the login API's success contract before leaving the login page. */
export async function navigateAfterAdminLogin(
  response: Response,
  navigate: (path: string) => void,
): Promise<AdminLoginNavigationResult> {
  if (!response.ok) return "rejected";

  const body: unknown = await response.json().catch(() => null);

  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    !("success" in body) ||
    body.success !== true
  ) {
    return "rejected";
  }

  navigate("/admin");
  return "navigated";
}
