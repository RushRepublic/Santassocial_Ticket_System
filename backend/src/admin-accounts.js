import { randomUUID } from "node:crypto";
import { z } from "zod";
import { passwordHash } from "./security.js";

const adminInput = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().trim().toLowerCase().max(190),
  password: z.string().min(12).max(200),
});

export async function createAdmin(db, input) {
  const account = adminInput.parse(input);
  const id = randomUUID();
  try {
    return await db.transaction(async (tx) => {
      const existing = await tx.all(
        "SELECT id FROM users WHERE LOWER(email) = ?",
        [account.email],
      );
      if (existing.length)
        throw new Error("An account with this email already exists.");
      const createdAt = new Date().toISOString();
      await tx.run(
        "INSERT INTO users (id,name,email,passwordHash,role,active,createdAt) VALUES (?,?,?,?,?,?,?)",
        [
          id,
          account.name,
          account.email,
          passwordHash(account.password),
          "ADMIN",
          1,
          createdAt,
        ],
      );
      await tx.run(
        "INSERT INTO audit_logs (id,userId,action,entityId,createdAt) VALUES (?,?,?,?,?)",
        [randomUUID(), null, "CLI_CREATE_ADMIN", id, createdAt],
      );
      return { id, name: account.name, email: account.email, role: "ADMIN" };
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY")
      throw new Error("An account with this email already exists.");
    throw error;
  }
}
