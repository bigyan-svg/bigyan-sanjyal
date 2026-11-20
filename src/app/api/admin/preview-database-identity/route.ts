import "server-only";

import { getPrismaDatabaseIdentity, prisma } from "@/lib/prisma";
import { createPreviewDatabaseIdentityHandler } from "@/lib/preview-database-identity-handler";
import { readPreviewDatabaseIdentity } from "@/lib/preview-database-identity";

const handlePreviewDatabaseIdentity = createPreviewDatabaseIdentityHandler({
  environment: process.env.VERCEL_ENV,
  runDiagnostic: (token) =>
    prisma.$transaction(
      (transaction) =>
        readPreviewDatabaseIdentity(
          transaction,
          token,
          getPrismaDatabaseIdentity().target?.host ?? null,
        ),
      { isolationLevel: "ReadCommitted" },
    ),
});

export async function GET(request: Request): Promise<Response> {
  return handlePreviewDatabaseIdentity(request);
}

export async function HEAD(request: Request): Promise<Response> {
  return handlePreviewDatabaseIdentity(request);
}

export async function POST(request: Request): Promise<Response> {
  return handlePreviewDatabaseIdentity(request);
}

export async function PUT(request: Request): Promise<Response> {
  return handlePreviewDatabaseIdentity(request);
}

export async function PATCH(request: Request): Promise<Response> {
  return handlePreviewDatabaseIdentity(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return handlePreviewDatabaseIdentity(request);
}

export async function OPTIONS(request: Request): Promise<Response> {
  return handlePreviewDatabaseIdentity(request);
}
