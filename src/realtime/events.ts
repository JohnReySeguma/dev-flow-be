/**
 * Live Sync events. Every payload names the workspace, the project and the actor (null for changes made by the
 * system, e.g. a GitHub webhook) so a client can ignore echoes of its own changes.
 */
export const REALTIME_EVENTS = [
  "issue.created",
  "issue.updated",
  "issue.moved",
  "issue.deleted",
  "sprint.created",
  "sprint.updated",
  "sprint.started",
  "sprint.completed",
  "sprint.deleted",
  "workflow.updated",
  "project.updated",
  "project.deleted",
  "presence.updated",
] as const;

export type RealtimeEvent = (typeof REALTIME_EVENTS)[number];

export type EventEnvelope = { workspaceId: string; projectKey: string; actorId: string | null };

/** Room every client of a project joins. Keyed by id because keys are only unique per workspace. */
export const projectRoom = (projectId: string) => `project:${projectId}`;

/** The project an event is about: its room and the payload's workspaceId and projectKey come from it. */
export type EventProject = { id: string; workspaceId: string; key: string };

type Emit = (room: string, event: RealtimeEvent, payload: EventEnvelope & Record<string, unknown>) => void;

/**
 * Decouples services from Socket.IO: services publish after their transaction commits; the
 * realtime server attaches the actual emitter at startup. Until then (and in tests without
 * sockets) publishing is a no-op.
 */
export function createEventBus() {
  let emit: Emit | null = null;
  return {
    attach(emitter: Emit) {
      emit = emitter;
    },
    publish(
      project: EventProject,
      event: RealtimeEvent,
      payload: { actorId: string | null } & Record<string, unknown>,
    ) {
      emit?.(projectRoom(project.id), event, { workspaceId: project.workspaceId, projectKey: project.key, ...payload });
    },
  };
}

export type EventBus = ReturnType<typeof createEventBus>;
