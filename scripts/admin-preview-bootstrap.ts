import { createInterface } from "node:readline/promises";
import { StringDecoder } from "node:string_decoder";
import {
  assertPreviewAdminConfirmation,
  getPreviewAdminTarget,
  PreviewAdminTargetError,
} from "../src/lib/admin-preview-target";
import { normalizeAdminOperatorEmail } from "../src/lib/admin-operator-guards";
import { hashAdminPassword } from "../src/lib/auth/password";
import { getPasswordRecoveryValidationFailure } from "../src/lib/auth/password-recovery-validation";
import {
  PREVIEW_ADMIN_TRANSACTION_ISOLATION,
  PreviewFirstAdminError,
  provisionFirstPreviewAdmin,
} from "../src/lib/preview-first-admin";
import { prisma } from "../src/lib/prisma";

let shouldDisconnect = false;

function promptLine(message: string): Promise<string> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  return terminal.question(message).finally(() => terminal.close());
}

function promptSecret(message: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
    return Promise.reject(new Error("Password entry requires an interactive terminal."));
  }

  process.stdout.write(message);
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise((resolve, reject) => {
    let value = "";
    const decoder = new StringDecoder("utf8");

    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.off("error", onError);
      process.stdin.off("end", onEnd);
      process.stdin.setRawMode(wasRaw ?? false);
      process.stdout.write("\n");
    };

    const onData = (chunk: Buffer | string) => {
      const input = typeof chunk === "string" ? chunk : decoder.write(chunk);
      for (const character of input) {
        if (character === "\u0003" || character === "\u0004") {
          cleanup();
          reject(new Error("Password entry cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = Array.from(value).slice(0, -1).join("");
          continue;
        }
        if (character >= " " && character !== "\u007f") {
          value += character;
          if (value.length > 1_024) {
            cleanup();
            reject(new Error("Password exceeds the maximum supported length."));
            return;
          }
        }
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onEnd = () => {
      cleanup();
      reject(new Error("Password input ended unexpectedly."));
    };

    process.stdin.on("data", onData);
    process.stdin.once("error", onError);
    process.stdin.once("end", onEnd);
  });
}

async function main(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new PreviewAdminTargetError(
      "Preview administrator provisioning requires an interactive terminal.",
    );
  }

  const target = getPreviewAdminTarget(process.env.DATABASE_URL);
  if (!target) {
    throw new PreviewAdminTargetError(
      "DATABASE_URL does not match the authorized Neon Preview target.",
    );
  }

  process.stdout.write(`Preview database target: ${target.display}\n`);
  const emailInput = await promptLine("Administrator email: ");
  const email = normalizeAdminOperatorEmail(emailInput);
  if (!email) throw new PreviewAdminTargetError("Enter a valid administrator email address.");

  let password = await promptSecret("New administrator password (input hidden): ");
  let confirmedPassword = await promptSecret("Confirm password (input hidden): ");
  let passwordHash: string;
  try {
    const passwordFailure = getPasswordRecoveryValidationFailure(password, confirmedPassword);
    if (passwordFailure === "mismatch") {
      throw new PreviewAdminTargetError("Password confirmation did not match.");
    }
    if (passwordFailure === "too-short") {
      throw new PreviewAdminTargetError("Password must contain at least 12 characters.");
    }
    if (passwordFailure === "too-long") {
      throw new PreviewAdminTargetError("Password exceeds the maximum supported length.");
    }
    passwordHash = await hashAdminPassword(password);
  } finally {
    password = "";
    confirmedPassword = "";
  }
  const confirmation = await promptLine(`Type "${target.confirmation}" to continue: `);
  assertPreviewAdminConfirmation(confirmation, target);

  shouldDisconnect = true;
  let account: { id: string };
  try {
    account = await prisma.$transaction(
      (transaction) =>
        provisionFirstPreviewAdmin(
          transaction as unknown as Parameters<typeof provisionFirstPreviewAdmin>[0],
          email,
          passwordHash,
        ),
      { isolationLevel: PREVIEW_ADMIN_TRANSACTION_ISOLATION },
    );
  } finally {
    passwordHash = "";
  }

  process.stdout.write(
    `Preview initial administrator provisioned (account ID ${account.id}) at ${target.display}.\n`,
  );
}

main()
  .catch((error: unknown) => {
    if (
      error instanceof PreviewAdminTargetError ||
      error instanceof PreviewFirstAdminError
    ) {
      process.stderr.write(`${error.message}\n`);
    } else {
      process.stderr.write(
        "Preview administrator provisioning failed. Database and credential details were suppressed.\n",
      );
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    if (shouldDisconnect) {
      await prisma.$disconnect().catch(() => {
        process.stderr.write("Unable to close the Prisma client cleanly.\n");
        process.exitCode = 1;
      });
    }
  });
