import "../src/env.js";
import { createInterface } from "node:readline";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

async function readPassword(): Promise<string> {
  const rl = createInterface({ input: process.stdin, terminal: false });
  try {
    for await (const line of rl) return line;
    throw new Error("Password missing on stdin");
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const username = process.argv[2]?.trim();
  const email = process.argv[3]?.trim().toLowerCase();
  if (
    !username ||
    username.length < 2 ||
    username.length > 64 ||
    !email ||
    !emailRegex.test(email)
  ) {
    throw new Error(
      "Usage: create-admin <username> <email> (password on stdin)",
    );
  }
  const password = await readPassword();
  if (password.length < 6)
    throw new Error("Password must contain at least 6 characters");
  const passwordHash = await bcrypt.hash(password, 12);
  const createdId = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findFirst({
      where: { OR: [{ username }, { email }] },
      select: { id: true },
    });
    if (existing)
      throw new Error(
        "Username or email already exists; existing accounts are never promoted",
      );
    const user = await tx.user.create({
      data: {
        username,
        displayName: username.split("#")[0],
        discriminator: username.includes("#")
          ? username.split("#").at(-1) || "00000"
          : "00000",
        email,
        passwordHash,
        role: "SUPER_ADMIN",
        status: "ONLINE",
      },
    });
    await tx.platformAuditLog.create({
      data: {
        actorId: user.id,
        action: "ADMIN_INIT_SCRIPT_CREATE",
        targetType: "USER",
        targetId: user.id,
        detailsJson: JSON.stringify({ username, email }),
      },
    });
    return user.id;
  });
  process.stdout.write(`Created SUPER_ADMIN ${username} (${email})\n`);
  process.stdout.write(`ACCEPTANCE_ADMIN_ID=${createdId}\n`);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Admin creation failed"}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
