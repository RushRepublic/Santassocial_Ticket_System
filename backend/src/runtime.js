import { openDatabase, migrate } from "./db.js";
import { seed } from "./setup.js";
import {
  demo,
  maintenanceMode,
  whatsappDemo,
  databaseDriver,
} from "./config.js";
import { maintain } from "./maintenance.js";
import { startNotificationWorker } from "./notification-worker.js";

export async function createRuntime() {
  const db = await openDatabase();
  try {
    // Additive session-only migration also runs when APP_MODE is live.
    // Never changes customer, booking, payment or admission records.
    await db.run(
      `CREATE TABLE IF NOT EXISTS revoked_staff_sessions (tokenHash VARCHAR(64) PRIMARY KEY, expiresAt VARCHAR(30) NOT NULL)${databaseDriver === "sqlite" ? "" : " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"}`,
    );
    if (demo) {
      await migrate(db);
      await seed(db);
    }
  } catch (error) {
    await db.close();
    throw error;
  }
  // Live WhatsApp must deliver even when broader maintenance uses cron.
  const notifications = whatsappDemo ? null : startNotificationWorker(db);
  let working = false;
  const timer =
    maintenanceMode === "interval"
      ? setInterval(async () => {
          if (working) return;
          working = true;
          try {
            await maintain(db);
          } catch {
            console.error("Background maintenance failed; will retry.");
          } finally {
            working = false;
          }
        }, 15000)
      : null;
  return {
    db,
    notify: () => notifications?.wake(),
    async close() {
      clearInterval(timer);
      await notifications?.close();
      while (working) await new Promise((resolve) => setTimeout(resolve, 25));
      await db.close();
    },
  };
}
