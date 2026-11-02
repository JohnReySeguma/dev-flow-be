import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import { createApp } from "../../src/app.js";
import type { Env } from "../../src/config/env.js";
import { resolveFeatures } from "../../src/config/features.js";
import { createLogger } from "../../src/lib/logger.js";
import { createPrismaClient } from "../../src/lib/prisma.js";
import { createRedisClient } from "../../src/lib/redis.js";
import { createRealtimeServer, REALTIME_NAMESPACE, SOCKET_PATH } from "../../src/realtime/server.js";
import { createServices } from "../../src/services.js";
import { createMemoryEmailProvider } from "./email.js";
import { testEnv } from "./env.js";

/** The app and the realtime server on a real HTTP port, as in production. Call `close()` in afterAll. */
export async function startRealtimeTestServer(options: { env?: Partial<Env> } = {}) {
  const env: Env = { ...testEnv(), ...options.env };
  const logger = createLogger(env);
  const prisma = createPrismaClient(env.DATABASE_URL);
  const redis = createRedisClient(env.REDIS_URL, logger);
  const deps = { env, features: resolveFeatures(env), logger, prisma, redis, email: createMemoryEmailProvider() };
  const services = createServices(deps);
  const app = createApp({ ...deps, services, rateLimits: false });
  const httpServer = createServer(app);
  const realtime = createRealtimeServer({
    httpServer,
    env,
    logger,
    redis,
    auth: services.auth,
    tokens: services.tokens,
    projects: services.projects,
    events: services.events,
  });
  await new Promise<void>((resolve) => {
    httpServer.listen(0, resolve);
  });
  const url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
  const sockets: Socket[] = [];

  /** Connects as a browser (session cookie + frontend Origin) or as a script (access token). */
  function client(credentials: { cookie?: string; token?: string; origin?: string }): Socket {
    const socket = connect(`${url}${REALTIME_NAMESPACE}`, {
      path: SOCKET_PATH,
      transports: ["websocket"],
      reconnection: false,
      forceNew: true,
      ...(credentials.token && { auth: { token: credentials.token } }),
      extraHeaders: {
        ...(credentials.cookie && { Cookie: credentials.cookie }),
        ...(credentials.origin !== undefined && { Origin: credentials.origin }),
      },
    });
    sockets.push(socket);
    return socket;
  }

  async function close() {
    for (const socket of sockets) socket.disconnect();
    await realtime.close();
    await new Promise<void>((resolve) => {
      httpServer.close(() => {
        resolve();
      });
    });
    await prisma.$disconnect();
    redis?.disconnect();
  }

  return { app, env, prisma, url, client, close };
}

/** Resolves with the next `event` payload, or rejects after `ms`. */
export function nextEvent<T = Record<string, unknown>>(socket: Socket, event: string, ms = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`no ${event} within ${ms} ms`));
    }, ms);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Resolves once connected, or rejects with the server's connect_error. */
export function connected(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("connect", () => {
      resolve();
    });
    socket.once("connect_error", (error: Error & { data?: unknown }) => {
      reject(error);
    });
  });
}

export function join(socket: Socket, key: string): Promise<{ ok: boolean; code?: string; projectKey?: string }> {
  return socket.emitWithAck("project:join", key);
}

/** Resolves with the first `event` payload that satisfies `match`, ignoring earlier ones. */
export function eventMatching<T>(socket: Socket, event: string, match: (payload: T) => boolean, ms = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const listener = (payload: T) => {
      if (!match(payload)) return;
      clearTimeout(timer);
      socket.off(event, listener);
      resolve(payload);
    };
    const timer = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`no matching ${event} within ${ms} ms`));
    }, ms);
    socket.on(event, listener);
  });
}
