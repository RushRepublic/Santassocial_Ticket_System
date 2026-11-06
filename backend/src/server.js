import { createApp } from "./app.js";
import { config, demo, paymentMode } from "./config.js";
import { createRuntime } from "./runtime.js";
const runtime = await createRuntime();
const server = createApp(runtime.db).listen(
  config.port,
  config.host,
  (error) => {
    if (error) {
      console.error("Unable to start Santa Social API:", error.message);
      process.exit(1);
    }
    console.log(
      `Santa Social API (${demo ? "DEMO — simulated OTP and payments" : "LIVE"})`,
    );
  },
);
async function shutdown() {
  server.close(async () => {
    await runtime.close();
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
