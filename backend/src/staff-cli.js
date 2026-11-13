import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

// Never accept passwords as arguments, where shell history could retain them.
if (process.argv.length > 2 || !process.stdin.isTTY || !process.stdout.isTTY) {
  console.error(
    "Run npm run staff:provision from an interactive terminal. No arguments are accepted.",
  );
  process.exitCode = 1;
} else {
  let hidden = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!hidden) process.stdout.write(chunk, encoding);
      callback();
    },
  });
  const prompt = createInterface({
    input: process.stdin,
    output,
    terminal: true,
    historySize: 0,
  });
  const secret = async (label) => {
    process.stdout.write(label);
    hidden = true;
    try {
      return await prompt.question("");
    } finally {
      hidden = false;
      process.stdout.write("\n");
    }
  };
  let db;
  prompt.on("SIGINT", () => prompt.close());
  try {
    const name = (
      await prompt.question("Staff name (used for new accounts): ")
    ).trim();
    const email = (await prompt.question("Staff email: ")).trim().toLowerCase();
    const password = await secret(
      "Initial password (12+ characters; blank for an existing account): ",
    );
    const confirmation = await secret("Confirm password: ");
    if (password !== confirmation) throw new Error("Passwords do not match.");
    if (password && (password.length < 12 || password.length > 200))
      throw new Error("Use a password between 12 and 200 characters.");
    const { provisionStaff } = await import("./admin-accounts.js");
    const { openDatabase } = await import("./db.js");
    db = await openDatabase();
    const account = await provisionStaff(db, { name, email, password });
    console.log(
      `Staff provisioned: ${account.email}. Sign in using the existing /login page.`,
    );
  } catch (error) {
    const safe = [
      "Passwords do not match.",
      "Use a password between 12 and 200 characters.",
      "Multiple accounts match this email. Resolve the duplicates before provisioning.",
      "This account is inactive. Review it before provisioning.",
    ];
    console.error(
      safe.includes(error.message)
        ? error.message
        : "Staff provisioning failed. Check the name/email, application environment and database connection. No credentials are printed.",
    );
    process.exitCode = 1;
  } finally {
    prompt.close();
    if (db) await db.close();
  }
}
