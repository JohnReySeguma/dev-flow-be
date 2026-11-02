import type { Server as HttpServer } from "node:http";
import { createAdapter } from "@socket.io/redis-adapter";
import { Server, type Namespace, type Socket } from "socket.io";
import type { Env } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import type { Redis } from "../lib/redis.js";
import { ACCESS_COOKIE } from "../modules/auth/auth.cookies.js";
import type { AuthService } from "../modules/auth/auth.service.js";
import type { Identity } from "../modules/auth/auth.types.js";
import type { ProjectsService } from "../modules/projects/projects.service.js";
import type { TokensService } from "../modules/tokens/tokens.service.js";
import type { WorkspaceService } from "../modules/workspace/workspace.service.js";
import { projectRoom, type EventBus } from "./events.js";

/** Under /api/v2 so the browser sends the /api/v2-scoped session cookie with the handshake. */
export const SOCKET_PATH = "/api/v2/socket.io";
export const REALTIME_NAMESPACE = "/realtime";

/** A joined project room, by project id. */
type JoinedProject = { workspaceId: string; workspace: string; projectKey: string };
type SocketData = { identity: Identity; projects: Map<string, JoinedProject> };
type Ack = (
  response: { ok: true; workspace: string; projectKey: string } | { ok: false; code: string; message: string },
) => void;

/** `{ workspace: "acme-inc", projectKey: "DEV" }`: the payload of project:join and project:leave. */
function roomRequest(payload: unknown): { workspace: string; projectKey: string } {
  const fields = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;
  const { workspace, projectKey } = fields;
  if (typeof workspace !== "string" || typeof projectKey !== "string") {
    throw new AppError(
      "VALIDATION_FAILED",
      'Send { workspace, projectKey }, e.g. { workspace: "acme-inc", projectKey: "DEV" }.',
    );
  }
  return { workspace, projectKey: projectKey.toUpperCase() };
}

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
  workspace: WorkspaceService;
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
      (identity) => {
        socket.data = { identity, projects: new Map() } satisfies SocketData;
        next();
      },
      (error: unknown) => {
        const code = error instanceof AppError ? error.code : "UNAUTHENTICATED";
        next(refused(code, error instanceof Error ? error.message : "Authentication required"));
      },
    );
  });

  /** Everyone currently in a project's room, across API instances. */
  async function broadcastPresence(projectId: string, room: JoinedProject, actorId: string | null) {
    const sockets = await realtime.in(projectRoom(projectId)).fetchSockets();
    const online = [...new Set(sockets.map((s) => (s.data as SocketData).identity.userId))];
    realtime
      .to(projectRoom(projectId))
      .emit("presence.updated", { workspaceId: room.workspaceId, projectKey: room.projectKey, actorId, online });
  }

  realtime.on("connection", (socket) => {
    const { identity, projects } = dataOf(socket);
    const fail = (ack: Ack | undefined, error: unknown) => {
      const appError = error instanceof AppError ? error : new AppError("INTERNAL_ERROR");
      ack?.({ ok: false, code: appError.code, message: appError.message });
    };

    // Membership is checked here, as on /workspaces/:ws routes: non-members get NOT_FOUND.
    socket.on("project:join", async (payload: unknown, ack?: Ack) => {
      try {
        const request = roomRequest(payload);
        if (identity.via === "token" && !identity.scopes.includes("issues:read")) {
          throw new AppError("FORBIDDEN", "This access token lacks the issues:read scope.");
        }
        const auth = await deps.workspace.enter(identity, request.workspace);
        const project = await deps.projects.find(auth, request.projectKey);
        const room = { workspaceId: auth.workspaceId, workspace: auth.workspace.slug, projectKey: project.key };
        await socket.join(projectRoom(project.id));
        projects.set(project.id, room);
        ack?.({ ok: true, workspace: room.workspace, projectKey: room.projectKey });
        await broadcastPresence(project.id, room, identity.userId);
      } catch (error) {
        fail(ack, error);
      }
    });

    socket.on("project:leave", async (payload: unknown, ack?: Ack) => {
      try {
        const request = roomRequest(payload);
        const entry = [...projects].find(
          ([, room]) => room.workspace === request.workspace && room.projectKey === request.projectKey,
        );
        if (entry) {
          await socket.leave(projectRoom(entry[0]));
          projects.delete(entry[0]);
          await broadcastPresence(entry[0], entry[1], identity.userId);
        }
        ack?.({ ok: true, ...request });
      } catch (error) {
        fail(ack, error);
      }
    });

    socket.on("disconnect", () => {
      for (const [projectId, room] of projects) {
        void broadcastPresence(projectId, room, identity.userId).catch((error: unknown) => {
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
