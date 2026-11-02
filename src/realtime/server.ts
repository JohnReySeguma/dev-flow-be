import type { Server as HttpServer } from "node:http";
import { createAdapter } from "@socket.io/redis-adapter";
import { Server, type Namespace, type Socket } from "socket.io";
import type { Env } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import type { Redis } from "../lib/redis.js";
import { ACCESS_COOKIE } from "../modules/auth/auth.cookies.js";
import type { AuthService } from "../modules/auth/auth.service.js";
import type { AuthContext } from "../modules/auth/auth.types.js";
import type { ProjectsService } from "../modules/projects/projects.service.js";
import type { TokensService } from "../modules/tokens/tokens.service.js";
import { projectRoom, type EventBus } from "./events.js";

/** Under /api/v1 so the browser sends the /api/v1-scoped session cookie with the handshake. */
export const SOCKET_PATH = "/api/v1/socket.io";
export const REALTIME_NAMESPACE = "/realtime";

type SocketData = { auth: AuthContext; projects: Map<string, string> };
type Ack = (response: { ok: true; projectKey: string } | { ok: false; code: string; message: string }) => void;

function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(";") ?? []) {
    const [key, ...rest] = part.trim().split("=");
    if (key !== name) continue;
    // A malformed escape is anyone's to send: treat it as no cookie, never throw (it would crash the process).
    try {
      return decodeURIComponent(rest.join("="));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** A connect_error the client can act on: `err.data.code` is the same code the REST API uses. */
function refused(code: string, message: string) {
  return Object.assign(new Error(message), { data: { code } });
}

export function createRealtimeServer(deps: {
  httpServer: HttpServer;
  env: Env;
  logger: Logger;
  redis: Redis | null;
  auth: AuthService;
  tokens: TokensService;
  projects: ProjectsService;
  events: EventBus;
}) {
  const { env, logger } = deps;
  const io = new Server(deps.httpServer, {
    path: SOCKET_PATH,
    cors: { origin: env.CORS_ORIGIN, credentials: true },
    // Cookie-authenticated handshakes must come from the frontend (cross-site WebSocket hijacking).
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      callback(null, origin === undefined || origin === env.CORS_ORIGIN);
    },
  });

  const pubClient = deps.redis?.duplicate() ?? null;
  const subClient = deps.redis?.duplicate() ?? null;
  if (pubClient && subClient) io.adapter(createAdapter(pubClient, subClient));

  const realtime: Namespace = io.of(REALTIME_NAMESPACE);
  const dataOf = (socket: Socket) => socket.data as SocketData;

  realtime.use((socket, next) => {
    const token: unknown = (socket.handshake.auth as Record<string, unknown>).token;
    const accessToken = cookieValue(socket.handshake.headers.cookie, ACCESS_COOKIE);
    const authenticate =
      typeof token === "string"
        ? deps.tokens.authenticate(token)
        : accessToken
          ? deps.auth.authenticate(accessToken)
          : Promise.reject(new AppError("UNAUTHENTICATED"));
    authenticate.then(
      (auth) => {
        socket.data = { auth, projects: new Map() } satisfies SocketData;
        next();
      },
      (error: unknown) => {
        const code = error instanceof AppError ? error.code : "UNAUTHENTICATED";
        next(refused(code, error instanceof Error ? error.message : "Authentication required"));
      },
    );
  });

  /** Everyone currently in a project's room, across API instances. */
  async function broadcastPresence(projectId: string, projectKey: string, actorId: string | null) {
    const sockets = await realtime.in(projectRoom(projectId)).fetchSockets();
    const online = [...new Set(sockets.map((s) => (s.data as SocketData).auth.userId))];
    realtime.to(projectRoom(projectId)).emit("presence.updated", { projectKey, actorId, online });
  }

  realtime.on("connection", (socket) => {
    const { auth, projects } = dataOf(socket);

    socket.on("project:join", async (key: unknown, ack?: Ack) => {
      try {
        if (typeof key !== "string") throw new AppError("VALIDATION_FAILED", "Send the project key, e.g. DEV.");
        if (auth.via === "token" && !auth.scopes.includes("issues:read")) {
          throw new AppError("FORBIDDEN", "This access token lacks the issues:read scope.");
        }
        const project = await deps.projects.find(auth, key);
        await socket.join(projectRoom(project.id));
        projects.set(project.id, project.key);
        ack?.({ ok: true, projectKey: project.key });
        await broadcastPresence(project.id, project.key, auth.userId);
      } catch (error) {
        const appError = error instanceof AppError ? error : new AppError("INTERNAL_ERROR");
        ack?.({ ok: false, code: appError.code, message: appError.message });
      }
    });

    socket.on("project:leave", async (key: unknown, ack?: Ack) => {
      const entry = [...projects].find(([, projectKey]) => projectKey === String(key).toUpperCase());
      if (entry) {
        await socket.leave(projectRoom(entry[0]));
        projects.delete(entry[0]);
        await broadcastPresence(entry[0], entry[1], auth.userId);
      }
      ack?.({ ok: true, projectKey: String(key).toUpperCase() });
    });

    socket.on("disconnect", () => {
      for (const [projectId, projectKey] of projects) {
        void broadcastPresence(projectId, projectKey, auth.userId).catch((error: unknown) => {
          logger.warn({ err: error }, "presence broadcast failed");
        });
      }
    });
  });

  deps.events.attach((room, event, payload) => {
    realtime.to(room).emit(event, payload);
  });

  return {
    io,
    /**
     * Disconnects clients and stops the adapter. Not io.close(): that would also close the HTTP
     * server, which the shutdown sequence closes itself once in-flight requests finish.
     */
    async close(): Promise<void> {
      realtime.disconnectSockets(true);
      io.engine.close();
      await Promise.allSettled([pubClient?.quit(), subClient?.quit()]);
    },
  };
}

export type RealtimeServer = ReturnType<typeof createRealtimeServer>;
