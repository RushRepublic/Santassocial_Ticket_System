import { dispatchNotifications } from "./providers.js";

// Independent of maintenance/cron: WhatsApp outbox delivery is part of the
// running application. Durable queued rows survive restarts and failed sends.
export function startNotificationWorker(
  db,
  { dispatch = dispatchNotifications, intervalMs = 15000 } = {},
) {
  let stopped = false;
  let running;
  function wake() {
    if (stopped || running) return running;
    running = Promise.resolve()
      .then(() => dispatch(db))
      .catch(() => {
        console.error(
          "WhatsApp notification worker will retry queued messages.",
        );
      })
      .finally(() => {
        running = undefined;
      });
    return running;
  }
  const timer = setInterval(wake, intervalMs);
  timer.unref?.();
  wake();
  return {
    wake,
    async close() {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}
