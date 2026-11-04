import { createInterface } from "node:readline/promises";
import { StringDecoder } from "node:string_decoder";
import { Prisma } from "../src/generated/prisma/client";
import {
  assertProductionAdminOperatorTarget,
  AdminOperatorGuardError,
  getAdminOperatorConfirmationPhrase,
  normalizeAdminOperatorEmail,
  type AdminOperatorAction,
} from "../src/lib/admin-operator-guards";
import { recoverAdminPasswordAndRevokeSessions } from "../src/lib/auth/password-change-transaction";
import { hashAdminPassword } from "../src/lib/auth/password";
import {
  getSafeDatabaseTarget,
} from "../src/lib/auth/auth-diagnostics";
import { getPasswordRecoveryValidationFailure } from "../src/lib/auth/password-recovery-validation";
import { prisma } from "../src/lib/prisma";

const action = process.argv[2];
let shouldDisconnect = false;

class AdminOperatorError extends AdminOperatorGuardError {}

function isAdminOperatorAction(value: string | undefined): value is AdminOperatorAction {
  return value === "provision-first" || value === "recover";
}

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

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onEnd = () => {
      cleanup();
      reject(new Error("Password input ended unexpectedly."));
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

    process.stdin.on("data", onData);
    process.stdin.once("error", onError);
    process.stdin.once("end", onEnd);
  });
}

async function confirmProductionTarget(action: AdminOperatorAction) {
  const target = getSafeDatabaseTarget(process.env.DATABASE_URL);
  assertProductionAdminOperatorTarget(process.env.NODE_ENV, target);

  const phrase = getAdminOperatorConfirmationPhrase(action, target);
  process.stdout.write(
    `Production database target: ${target.host}:${target.port}/${target.database}\n`,
  );
  process.stdout.write("Verify this target against the approved operator record.\n");
  const confirmation = await promptLine(`Type "${phrase}" to continue: `);
  if (confirmation !== phrase) {
    throw new AdminOperatorError("Production target confirmation did not match.");
  }
  return target;
}

async function readAndHashPassword(): Promise<string> {
  const password = await promptSecret("New administrator password (input hidden): ");
  const confirmation = await promptSecret("Confirm password (input hidden): ");
  const failure = getPasswordRecoveryValidationFailure(password, confirmation);
  if (failure === "mismatch") {
    throw new AdminOperatorError("Password confirmation did not match.");
  }
  if (failure === "too-short") {
    throw new AdminOperatorError("Password must contain at least 12 characters.");
  }
  if (failure === "too-long") {
    throw new AdminOperatorError("Password exceeds the maximum supported length.");
  }
  return hashAdminPassword(password);
}

async function provisionFirstAdmin(): Promise<void> {
  const target = await confirmProductionTarget("provision-first");
  const emailInput = await promptLine("Administrator email: ");
  const email = normalizeAdminOperatorEmail(emailInput);
  if (!email) throw new AdminOperatorError("Enter a valid administrator email address.");
  const passwordHash = await readAndHashPassword();

  shouldDisconnect = true;
  const account = await prisma.$transaction(
    async (transaction) => {
      const existingAccounts = await transaction.adminUser.count();
      if (existingAccounts !== 0) {
        throw new AdminOperatorError(
          "First-admin provisioning is allowed only when no admin accounts exist.",
        );
      }
      return transaction.adminUser.create({
        data: {
          email,
          passwordHash,
          role: "ADMIN",
          isActive: true,
        },
        select: { id: true },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  process.stdout.write(
    `Initial administrator provisioned (account ID ${account.id}) at ${target.host}/${target.database}.\n`,
  );
}

async function recoverAdminAccess(): Promise<void> {
  const target = await confirmProductionTarget("recover");
  const emailInput = await promptLine("Existing administrator email: ");
  const email = normalizeAdminOperatorEmail(emailInput);
  if (!email) throw new AdminOperatorError("Enter a valid administrator email address.");

  shouldDisconnect = true;
  const account = await prisma.adminUser.findUnique({
    where: { email },
    select: { id: true, role: true, isActive: true },
  });
  if (!account || account.role !== "ADMIN" || !account.isActive) {
    throw new AdminOperatorError("No eligible active administrator account was found.");
  }

  const newPasswordHash = await readAndHashPassword();
  await prisma.$transaction(async (transaction) => {
    await recoverAdminPasswordAndRevokeSessions(
      (query, ...values) => transaction.$executeRaw(query, ...values),
      { userId: account.id, newPasswordHash },
    );
  });

  process.stdout.write(
    `Administrator password recovered and sessions revoked at ${target.host}/${target.database}.\n`,
  );
}

async function main(): Promise<void> {
  if (!isAdminOperatorAction(action)) {
    throw new AdminOperatorError(
      "Usage: npm run admin:operator -- <provision-first|recover>",
    );
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new AdminOperatorError("Admin operator commands require an interactive terminal.");
  }

  if (action === "provision-first") {
    await provisionFirstAdmin();
  } else {
    await recoverAdminAccess();
  }
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      error instanceof AdminOperatorGuardError
        ? `${error.message}\n`
        : "Admin operator failed. Database and credential details were suppressed.\n",
    );
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
