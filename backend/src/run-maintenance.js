import { openDatabase } from "./db.js";
import { maintain } from "./maintenance.js";

const db = await openDatabase();
try {
  await maintain(db);
  console.log("Santa Social maintenance complete.");
} finally {
  await db.close();
}
