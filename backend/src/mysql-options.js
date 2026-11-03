// Prefer individual fields when supplied. Passwords here are literal values;
// only DATABASE_URL requires URL encoding. Never include credentials in errors.
export function mysqlOptions(env = process.env) {
  const fields = ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME"];
  if (fields.some((key) => env[key] !== undefined && env[key] !== "")) {
    for (const key of ["DB_USER", "DB_PASSWORD", "DB_NAME"])
      if (!env[key])
        throw Error(`Set ${key} when using individual MySQL fields.`);
    const port = Number(env.DB_PORT || 3306);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw Error("DB_PORT must be an integer between 1 and 65535.");
    return {
      host: env.DB_HOST || "127.0.0.1",
      port,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
    };
  }
  try {
    const url = new URL(env.DATABASE_URL || "");
    if (
      url.protocol === "mysql:" &&
      url.hostname &&
      url.username &&
      url.pathname.length > 1
    )
      return { uri: env.DATABASE_URL };
  } catch {}
  throw Error(
    "Set DB_USER, DB_PASSWORD and DB_NAME, or a valid mysql:// DATABASE_URL.",
  );
}
