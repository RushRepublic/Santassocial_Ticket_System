import { dispatchNotifications, reconcilePayments } from "./providers.js";
import { expire, lockEvent } from "./services.js";

export async function maintain(db) {
  await db.transaction(async (tx) => {
    await lockEvent(tx);
    await expire(tx);
  });
  await dispatchNotifications(db);
  await reconcilePayments(db);
}
