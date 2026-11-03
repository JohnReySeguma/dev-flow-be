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
  "membership.ended",
] as const;

export type RealtimeEvent = (typeof REALTIME_EVENTS)[number];

export type EventEnvelope = { workspaceId: string; projectKey: string; actorId: string | null };

/** Room every client of a project joins. Keyed by id because keys are only unique per workspace. */
export const projectRoom = (projectId: string) => `project:${projectId}`;

/** Room of one member's sockets in one workspace, so their access can be ended across instances. */
export const memberRoom = (workspaceId: string, userId: string) => `member:${workspaceId}:${userId}`;

/** The project an event is about: its room and the payload's workspaceId and projectKey come from it. */
export type EventProject = { id: string; workspaceId: string; key: string };

type Emit = (room: string, event: RealtimeEvent, payload: EventEnvelope & Record<string, unknown>) => void;

/** People who lost access to a workspace, and its projects, whose rooms they must leave. */
type EndMemberships = (
  workspaceId: string,
  userIds: string[],
  projects: { id: string; key: string }[],
) => Promise<void>;

/**
 * Decouples services from Socket.IO: services publish after their transaction commits; the
 * realtime server attaches the actual emitter at startup. Until then (and in tests without
 * sockets) publishing is a no-op.
 */
export function createEventBus() {
  let emit: Emit | null = null;
  let endMemberships: EndMemberships | null = null;
  return {
    attach(handlers: { emit: Emit; endMemberships: EndMemberships }) {
      emit = handlers.emit;
      endMemberships = handlers.endMemberships;
    },
    /** After a removal, a leave or a workspace deletion committed: their sockets stop receiving its events. */
    async membershipsEnded(workspaceId: string, userIds: string[], projects: { id: string; key: string }[]) {
      await endMemberships?.(workspaceId, userIds, projects);
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
