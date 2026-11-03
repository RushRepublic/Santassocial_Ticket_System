import { randomUUID } from "node:crypto";
import { openDatabase, migrate } from "./db.js";
import { demo, production } from "./config.js";
import { passwordHash } from "./security.js";
import { now } from "./services.js";
import { pathToFileURL } from "node:url";
export async function seed(db) {
  for (const role of ["ADMIN", "CASHIER", "SCANNER"]) {
    const email =
      process.env[`${role}_EMAIL`] || `${role.toLowerCase()}@santasocial.local`;
    const password =
      process.env[`${role}_PASSWORD`] ||
      (demo && !production ? "SantaDemo2026!" : "");
    if (!password) {
      if (role === "ADMIN")
        throw Error("Set ADMIN_PASSWORD before seeding live users.");
      continue;
    }
    if (password.length < 12)
      throw Error(`${role}_PASSWORD must contain at least 12 characters.`);
    if (!(await db.all("SELECT id FROM users WHERE email = ?", [email])).length)
      await db.run(
        "INSERT INTO users (id,name,email,passwordHash,role,createdAt) VALUES (?,?,?,?,?,?)",
        [
          randomUUID(),
          `Santa Social ${role.toLowerCase()}`,
          email,
          passwordHash(password),
          role,
          now(),
        ],
      );
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const db = await openDatabase();
  try {
    await migrate(db);
    if (process.argv[2] === "seed") await seed(db);
    console.log("Database setup complete.");
  } finally {
    await db.close();
  }
}
