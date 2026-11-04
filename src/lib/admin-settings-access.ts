export function isAdminSettingsRole(role: unknown): role is "ADMIN" | "EDITOR" {
  return role === "ADMIN" || role === "EDITOR";
}
