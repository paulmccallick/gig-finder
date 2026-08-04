const root = new URL("../../", import.meta.url).pathname;
const apiPort = process.env.DEV_API_PORT ?? "3101";

const api = Bun.spawn(["bun", "--watch", "src/web/server.ts"], {
  cwd: root,
  env: {
    ...process.env,
    PORT: apiPort,
    AI_SDK_DEVTOOLS: process.env.AI_SDK_DEVTOOLS ?? "true",
  },
  stdout: "inherit",
  stderr: "inherit",
});

const client = Bun.spawn(
  ["bun", "x", "vite", "--config", "src/web/vite.config.ts", "--host", "127.0.0.1"],
  {
    cwd: root,
    env: { ...process.env, PORT: apiPort },
    stdout: "inherit",
    stderr: "inherit",
  },
);

const stop = () => {
  api.kill();
  client.kill();
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await Promise.race([api.exited, client.exited]);
stop();
