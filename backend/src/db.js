import mysql from "mysql2/promise";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { databaseDriver } from "./config.js";
import { mysqlOptions } from "./mysql-options.js";
import { hash, qrToken } from "./security.js";
const tables = readFileSync(
  new URL("../migrations/001_initial.sql", import.meta.url),
  "utf8",
)
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);
export async function openDatabase() {
  if (databaseDriver === "sqlite") {
    const { DatabaseSync } = await import("node:sqlite");
    const file = process.env.DEMO_DB_PATH || resolve("data/demo.sqlite");
    mkdirSync(dirname(file), { recursive: true });
    const sqlite = new DatabaseSync(file);
    sqlite.exec(
      "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
    );
    const tx = {
      all: async (s, v = []) =>
        sqlite.prepare(s.replace(/ FOR UPDATE/g, "")).all(...v),
      run: async (s, v = []) => ({
        changes: Number(
          sqlite.prepare(s.replace(/ FOR UPDATE/g, "")).run(...v).changes,
        ),
      }),
    };
    let queue = Promise.resolve();
    const serial = (work) => {
      const result = queue.then(work);
      queue = result.then(
        () => {},
        () => {},
      );
      return result;
    };
    return {
      all: (s, v) => serial(() => tx.all(s, v)),
      run: (s, v) => serial(() => tx.run(s, v)),
      transaction: (work) =>
        serial(async () => {
          sqlite.exec("BEGIN IMMEDIATE");
          try {
            const r = await work(tx);
            sqlite.exec("COMMIT");
            return r;
          } catch (e) {
            sqlite.exec("ROLLBACK");
            throw e;
          }
        }),
      close: async () => {
        await queue;
        sqlite.close();
      },
    };
  }
  const pool = mysql.createPool({
    ...mysqlOptions(),
    connectionLimit: 10,
    charset: "utf8mb4_unicode_ci",
    timezone: "Z",
    enableKeepAlive: true,
  });
  const wrap = (connection) => ({
    all: async (s, v = []) => {
      const [rows] = await connection.execute(s, v);
      return rows;
    },
    run: async (s, v = []) => {
      const [r] = await connection.execute(s, v);
      return { changes: r.affectedRows };
    },
  });
  return {
    ...wrap(pool),
    transaction: async (work) => {
      const c = await pool.getConnection();
      try {
        await c.beginTransaction();
        const r = await work(wrap(c));
        await c.commit();
        return r;
      } catch (e) {
        await c.rollback();
        throw e;
      } finally {
        c.release();
      }
    },
    close: () => pool.end(),
  };
}
export async function migrate(db) {
  for (const sql of tables)
    await db.run(
      databaseDriver === "mysql"
        ? `${sql} ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        : sql,
    );
  for (const [table, index, cols] of [
    ["bookings", "idx_bookings_mobile", "mobile,createdAt"],
    [
      "bookings",
      "idx_bookings_inventory",
      "eventId,status,holdUntil,eventDate",
    ],
    ["bookings", "idx_bookings_date", "eventDate,createdAt"],
    ["otp_verifications", "idx_otp_mobile", "mobile,createdAt"],
    ["notification_logs", "idx_notify_retry", "status,nextAttemptAt"],
    ["checkins", "idx_checkins_date", "eventDate,createdAt"],
  ]) {
    try {
      await db.run(`CREATE INDEX ${index} ON ${table} (${cols})`);
    } catch (e) {
      if (!/already exists|Duplicate key name/i.test(String(e))) throw e;
    }
  }
  if (
    !(await db.all("SELECT id FROM events WHERE id = ?", ["santa-2026"])).length
  )
    await db.run("INSERT INTO events (id,name,capacity) VALUES (?,?,?)", [
      "santa-2026",
      "Santa Social 9th Edition",
      0,
    ]);
  // Existing cash reservations keep the same deterministic token after approval.
  for (const b of await db.all(
    "SELECT * FROM bookings WHERE method = 'CASH' AND status IN ('PENDING_CASH','EXPIRED') AND qrHash IS NULL",
  ))
    await db.run(
      "UPDATE bookings SET qrHash = ? WHERE id = ? AND qrHash IS NULL",
      [hash(qrToken(b)), b.id],
    );
}
