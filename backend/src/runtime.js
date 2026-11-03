import { openDatabase, migrate } from "./db.js";
import { seed } from "./setup.js";
import { demo, maintenanceMode } from "./config.js";
import { maintain } from "./maintenance.js";

export async function createRuntime() {
  const db = await openDatabase();
  try {
    if (demo) {
      await migrate(db);
      await seed(db);
    }
  } catch (error) {
    await db.close();
    throw error;
  }
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
    async close() {
      clearInterval(timer);
      while (working) await new Promise((resolve) => setTimeout(resolve, 25));
      await db.close();
    },
  };
}
