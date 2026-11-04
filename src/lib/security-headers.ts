export const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
] as const;

export function getStrictTransportSecurityHeader(
  nodeEnv: string | undefined,
  protocol: string,
): string | null {
  if (nodeEnv !== "production" || protocol !== "https:") return null;
  return "max-age=31536000";
}
