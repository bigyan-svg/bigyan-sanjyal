export function createLoginRateLimitedResponse(retryAfterSeconds: number): Response {
  return Response.json(
    { error: "Too many sign-in attempts. Please try again later." },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(retryAfterSeconds),
      },
    },
  );
}
