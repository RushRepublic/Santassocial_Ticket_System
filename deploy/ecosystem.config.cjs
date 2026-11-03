const path = require("node:path");
const root = path.resolve(__dirname, "..");
module.exports = {
  apps: [
    {
      name: "santa-api",
      cwd: path.join(root, "backend"),
      script: "src/server.js",
      instances: 1,
      exec_mode: "fork",
      env: { NODE_ENV: "production", APP_MODE: "live", HOST: "127.0.0.1" },
      max_memory_restart: "600M",
      time: true,
    },
    {
      name: "santa-web",
      cwd: path.join(root, "frontend"),
      script: path.join(root, "node_modules/next/dist/bin/next"),
      args: "start --hostname 127.0.0.1 --port 3000",
      instances: 1,
      exec_mode: "fork",
      env: { NODE_ENV: "production" },
      max_memory_restart: "700M",
      time: true,
    },
  ],
};
