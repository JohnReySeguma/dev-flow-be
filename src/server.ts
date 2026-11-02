import { createServer } from "node:http";
import { API_PREFIX, createApp } from "./app.js";
import { EnvError, loadEnv, type Env } from "./config/env.js";
import { createLogger } from "./lib/logger.js";
import { createShutdown } from "./lib/shutdown.js";

function readEnv(): Env {
  try {
    return loadEnv();
  } catch (error) {
    if (error instanceof EnvError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

const env = readEnv();
const logger = createLogger(env);
const app = createApp({ env, logger });
const server = createServer(app);

const shutdown = createShutdown({
  logger,
  tasks: [
    {
      name: "http server",
      close: () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) reject(error);
            else resolve();
          });
          // Let in-flight requests finish, but drop idle keep-alive sockets right away.
          server.closeIdleConnections();
        }),
    },
  ],
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => void shutdown(signal));
}

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, `api listening on http://localhost:${env.PORT}${API_PREFIX}`);
});
