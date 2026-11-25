export const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin-allow-popups",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
] as const;

export const CSP_REPORT_ONLY_ENABLED = true;

// The HTTPS image source is provisional. Investigate framework-generated inline
// scripts/styles and streamed RSC payload violations before considering enforcement.
export const CSP_REPORT_ONLY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "frame-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' https:",
  "font-src 'self'",
  "connect-src 'self'",
].join("; ");

export function getSecurityHeaders(
  reportOnlyEnabled = CSP_REPORT_ONLY_ENABLED,
) {
  if (!reportOnlyEnabled) return [...SECURITY_HEADERS];

  return [
    ...SECURITY_HEADERS,
    {
      key: "Content-Security-Policy-Report-Only",
      value: CSP_REPORT_ONLY_POLICY,
    },
  ];
}

export function getStrictTransportSecurityHeader(
  nodeEnv: string | undefined,
  protocol: string,
): string | null {
  if (nodeEnv !== "production" || protocol !== "https:") return null;
  return "max-age=31536000";
}
