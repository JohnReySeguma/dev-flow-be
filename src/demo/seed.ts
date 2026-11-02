import { generateNKeysBetween } from "fractional-indexing";
import { Prisma } from "../generated/prisma/client.js";
import type { Logger } from "../lib/logger.js";
import { hashPassword } from "../lib/password.js";
import type { PrismaClient } from "../lib/prisma.js";
import { DEMO_MEMBERS, DEMO_PASSWORD, DEMO_WORKSPACE_NAME, seedAccounts, type MemberRef } from "./accounts.js";
import { DEMO_COMMENTS, DEMO_ISSUES, DEMO_PROJECTS, DEMO_SPRINTS } from "./tracker-data.js";

const DAY = 24 * 60 * 60 * 1000;
const SPRINT_LENGTH_DAYS = 14;

type TrackerContext = {
  workspaceId: string;
  /** Who plays each of the frontend's team members; anyone missing leaves their work unassigned. */
  users: Partial<Record<MemberRef, string>>;
  now: number;
  /**
   * A sample copy for someone's own workspace: `owner` leads every project and there are no
   * comments, since the demo team are not members there.
   */
  owner?: string;
  /** Only these project keys (e.g. the ones still free in a workspace); all of them by default. */
  keys?: ReadonlySet<string>;
};

/**
 * Creates the demo projects, sprints, issues and comments in an existing workspace, with every
 * date relative to `now`. Issue history is recorded the way the API would have recorded it, so
 * burndown has real data: active-sprint issues join at sprint start; done issues resolve at
 * their resolvedAt.
 */
export async function seedTracker(tx: Prisma.TransactionClient, context: TrackerContext): Promise<void> {
  const at = (days: number) => new Date(context.now + days * DAY);
  const team = Object.values(context.users);
  const withComments = context.owner === undefined;

  for (const demo of DEMO_PROJECTS.filter((p) => context.keys?.has(p.key) ?? true)) {
    const project = await tx.project.create({
      data: {
        workspaceId: context.workspaceId,
        key: demo.key,
        name: demo.name,
        description: demo.description,
        color: demo.color,
        leadId: context.owner ?? context.users[demo.lead] ?? null,
        nextIssueNumber: demo.nextIssueNumber,
        isSample: true,
        createdAt: at(demo.created),
      },
    });

    const statuses = new Map<string, { id: string; category: string }>();
    for (const [position, status] of demo.workflow.entries()) {
      const created = await tx.workflowStatus.create({
        data: { projectId: project.id, name: status.name, category: status.category, position },
      });
      statuses.set(status.ref, { id: created.id, category: status.category });
    }
    const firstTodo = demo.workflow.find((s) => s.category === "todo");

    const issues = DEMO_ISSUES.filter((issue) => issue.key.startsWith(`${demo.key}-`));
    const sprints = new Map<string, { id: string; start: Date | null }>();
    for (const sprint of DEMO_SPRINTS.filter((s) => s.project === demo.key)) {
      const base = { projectId: project.id, number: sprint.number, name: `Sprint ${sprint.number}`, goal: sprint.goal };
      let data: Prisma.SprintUncheckedCreateInput;
      if (sprint.status === "completed") {
        data = {
          ...base,
          status: "completed",
          startAt: at(-sprint.endDaysAgo - SPRINT_LENGTH_DAYS),
          endAt: at(-sprint.endDaysAgo),
          completedAt: at(-sprint.endDaysAgo),
          committedPoints: sprint.report.committedPoints,
          reportCommittedPoints: sprint.report.committedPoints,
          reportCompletedPoints: sprint.report.completedPoints,
          reportCompletedIssues: sprint.report.completedIssues,
          reportCarriedOverIssues: sprint.report.carriedOverIssues,
        };
      } else if (sprint.status === "active") {
        // Active sprints commit to whatever they contained when they started.
        const committed = issues
          .filter((issue) => issue.sprint === sprint.ref)
          .reduce((sum, issue) => sum + (issue.estimate ?? 0), 0);
        data = {
          ...base,
          status: "active",
          startAt: at(sprint.start),
          endAt: at(sprint.end),
          committedPoints: committed,
        };
      } else {
        data = { ...base, status: "planned" };
      }
      const created = await tx.sprint.create({ data });
      sprints.set(sprint.ref, { id: created.id, start: created.startAt });
    }

    const ranks = generateNKeysBetween(null, null, issues.length);
    for (const [index, demoIssue] of issues.entries()) {
      const status = statuses.get(demoIssue.status);
      const sprint = demoIssue.sprint ? sprints.get(demoIssue.sprint) : undefined;
      if (!status || (demoIssue.sprint && !sprint))
        throw new Error(`demo issue ${demoIssue.key} has a broken reference`);
      const createdAt = at(demoIssue.updated - 5);
      const updatedAt = at(demoIssue.updated);
      const resolvedAt = demoIssue.resolved === undefined ? null : at(demoIssue.resolved);
      const assigneeId = demoIssue.assignee ? (context.users[demoIssue.assignee] ?? null) : null;

      const issue = await tx.issue.create({
        data: {
          projectId: project.id,
          number: Number(demoIssue.key.split("-")[1]),
          sprintId: sprint?.id ?? null,
          statusId: status.id,
          type: demoIssue.type,
          priority: demoIssue.priority,
          title: demoIssue.title,
          description: demoIssue.description ?? "",
          assigneeId,
          tags: demoIssue.tags,
          git: demoIssue.git ?? Prisma.DbNull,
          estimate: demoIssue.estimate,
          commentCount: withComments ? demoIssue.comments : 0,
          rank: ranks[index] ?? "a0",
          dueAt: demoIssue.due === undefined ? null : at(demoIssue.due),
          resolvedAt,
          createdAt,
          updatedAt,
        },
      });

      // Active sprints commit to what they held at the start, so their issues join then.
      const joined = sprint?.start ?? createdAt;
      const openStatus = status.category === "done" ? (statuses.get(firstTodo?.ref ?? "")?.id ?? status.id) : status.id;
      const base = {
        issueId: issue.id,
        projectId: project.id,
        actorId: assigneeId,
        sprintId: issue.sprintId,
        estimate: issue.estimate,
      };
      await tx.issueEvent.createMany({
        data: [
          { ...base, kind: "created", statusId: openStatus, done: false, createdAt: joined },
          ...(resolvedAt
            ? [{ ...base, kind: "status" as const, statusId: status.id, done: true, createdAt: resolvedAt }]
            : []),
        ],
      });

      // As many comments as the frontend shows, spread between creation and the last update.
      if (!withComments) continue;
      await tx.issueComment.createMany({
        data: Array.from({ length: demoIssue.comments }, (_, n) => ({
          issueId: issue.id,
          authorId: team[(index + n) % team.length] ?? null,
          body: DEMO_COMMENTS[(index + n) % DEMO_COMMENTS.length] ?? "Noted.",
          createdAt: new Date(
            createdAt.getTime() + ((n + 1) / (demoIssue.comments + 1)) * (updatedAt.getTime() - createdAt.getTime()),
          ),
        })),
      });
    }
  }
}

/**
 * Seeds the whole demo workspace (team, tokens, projects) into an empty database, so it is
 * safe to run on every container start. Returns whether anything was written.
 * `tracker: false` seeds only the workspace and team (tests that build their own projects).
 */
export async function seedDemo(
  prisma: PrismaClient,
  logger: Logger,
  now = Date.now(),
  options: { tracker?: boolean } = {},
): Promise<boolean> {
  if ((await prisma.workspace.count()) > 0) {
    logger.info("seed skipped: database already has data");
    return false;
  }
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  await prisma.$transaction(
    async (tx) => {
      const { workspaceId, users } = await seedAccounts(tx, passwordHash, now);
      if (options.tracker !== false) await seedTracker(tx, { workspaceId, users, now });
    },
    { timeout: 60_000 },
  );
  logger.info(
    { workspace: DEMO_WORKSPACE_NAME, members: DEMO_MEMBERS.length, projects: DEMO_PROJECTS.length },
    "seeded demo data",
  );
  return true;
}

/**
 * Copies the sample projects (DEV, BIL, MOB) into a new workspace for `ownerId`: the issues the
 * demo admin works on are theirs, everything else is unassigned, and there are no comments.
 */
export async function copySampleTracker(
  prisma: PrismaClient,
  workspaceId: string,
  ownerId: string,
  now = Date.now(),
): Promise<void> {
  await prisma.$transaction((tx) => seedTracker(tx, { workspaceId, users: { "u-jr": ownerId }, owner: ownerId, now }), {
    timeout: 60_000,
  });
}

/**
 * Replaces a workspace's projects with a fresh copy of the demo tracker, dated relative to now.
 * Accounts are untouched, as with the frontend's "Reset demo data"; demo members who were
 * removed come back as unassigned work.
 */
export async function resetDemoTracker(prisma: PrismaClient, workspaceId: string, now = Date.now()): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await tx.project.deleteMany({ where: { workspaceId } });
      const members = await tx.user.findMany({
        where: { email: { in: DEMO_MEMBERS.map((m) => m.email) }, memberships: { some: { workspaceId } } },
        select: { id: true, email: true },
      });
      const users: Partial<Record<MemberRef, string>> = {};
      for (const member of DEMO_MEMBERS) {
        const user = members.find((u) => u.email === member.email);
        if (user) users[member.ref] = user.id;
      }
      await seedTracker(tx, { workspaceId, users, now });
    },
    { timeout: 60_000 },
  );
}
