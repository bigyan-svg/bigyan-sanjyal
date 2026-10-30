import "dotenv/config";

import { emitKeypressEvents, type Key } from "node:readline";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { hashAdminPassword } from "../src/lib/auth/password";
import { prisma } from "../src/lib/prisma";

const MAX_EMAIL_LENGTH = 320;
const MAX_PASSWORD_LENGTH = 1_024;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const ADMIN_CREATION_LOCK_NAMESPACE = 1_112_109_145;
const ADMIN_CREATION_LOCK_ID = 1;

class UserInputError extends Error {}
class ActiveAdminExistsError extends Error {}
class DuplicateEmailError extends Error {}

function promptEmail(): Promise<string> {
  const prompt = createInterface({ input: stdin, output: stdout });

  return prompt.question("Administrator email: ").finally(() => {
    prompt.close();
  });
}

function promptHidden(prompt: string): Promise<string> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    return Promise.reject(
      new UserInputError(
        "Run this command in an interactive terminal so password input can be hidden.",
      ),
    );
  }

  return new Promise((resolve, reject) => {
    const wasRaw = stdin.isRaw;
    const wasPaused = stdin.isPaused();
    let value = "";

    const cleanup = () => {
      stdin.off("keypress", onKeypress);
      stdin.setRawMode(wasRaw);

      if (wasPaused) {
        stdin.pause();
      }
    };

    const onKeypress = (character: string | undefined, key: Key) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        value = "";
        stdout.write("\n");
        reject(new UserInputError("Password input was cancelled."));
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        cleanup();
        stdout.write("\n");
        resolve(value);
        value = "";
        return;
      }

      if (key.name === "backspace") {
        value = Array.from(value).slice(0, -1).join("");
        return;
      }

      if (key.ctrl || key.meta || !character) {
        return;
      }

      if (!/[\u0000-\u001f\u007f]/u.test(character)) {
        value += character;
      }
    };

    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("keypress", onKeypress);
    stdout.write(prompt);
  });
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

async function createInitialAdmin(email: string, passwordHash: string): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        ${ADMIN_CREATION_LOCK_NAMESPACE},
        ${ADMIN_CREATION_LOCK_ID}
      ) IS NOT NULL AS locked
    `;

    const activeAdmin = await transaction.adminUser.findFirst({
      where: { role: "ADMIN", isActive: true },
      select: { id: true },
    });

    if (activeAdmin) {
      throw new ActiveAdminExistsError();
    }

    const existingEmail = await transaction.adminUser.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingEmail) {
      throw new DuplicateEmailError();
    }

    await transaction.adminUser.create({
      data: {
        email,
        passwordHash,
        role: "ADMIN",
        isActive: true,
      },
      select: { id: true },
    });
  });
}

async function main(): Promise<void> {
  try {
    if (process.argv.length > 2) {
      throw new UserInputError("This command does not accept arguments.");
    }

    const email = (await promptEmail()).trim().toLowerCase();

    if (
      email.length === 0 ||
      email.length > MAX_EMAIL_LENGTH ||
      !EMAIL_PATTERN.test(email)
    ) {
      throw new UserInputError("Enter a valid administrator email address.");
    }

    let password = await promptHidden("Password (input hidden): ");
    let confirmation = await promptHidden("Confirm password (input hidden): ");

    try {
      if (password !== confirmation) {
        throw new UserInputError("The password entries do not match.");
      }

      const passwordLength = Array.from(password).length;

      if (passwordLength < 12 || passwordLength > MAX_PASSWORD_LENGTH) {
        throw new UserInputError(
          `Use a password between 12 and ${MAX_PASSWORD_LENGTH} characters long.`,
        );
      }

      let passwordHash = await hashAdminPassword(password);
      password = "";
      confirmation = "";

      try {
        await createInitialAdmin(email, passwordHash);
      } finally {
        passwordHash = "";
      }
    } finally {
      password = "";
      confirmation = "";
    }

    stdout.write("Administrator account created successfully.\n");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (error instanceof ActiveAdminExistsError) {
    console.error("An active ADMIN account already exists; no account was created.");
  } else if (error instanceof DuplicateEmailError || isUniqueConstraintError(error)) {
    console.error("An account with that email already exists; no account was created.");
  } else if (error instanceof UserInputError) {
    console.error(error.message);
  } else {
    console.error("Admin account creation failed. Check the database connection and try again.");
  }

  process.exitCode = 1;
});
