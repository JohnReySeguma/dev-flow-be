import { config as loadDotenv } from "dotenv";
import { z } from "zod";

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/, error: "must be a postgresql:// URL" });
const redisUrl = z.url({ protocol: /^rediss?$/, error: "must be a redis:// or rediss:// URL" });
const booleanString = z
  .enum(["true", "false", "1", "0"], { error: "must be true or false" })
  .transform((value) => value === "true" || value === "1");

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    /** Reduced to an origin: browsers send "https://app.example", never a trailing slash or path. */
    CORS_ORIGIN: z
      .url({ error: "must be the frontend URL, e.g. http://localhost:3000" })
      .default("http://localhost:3000")
      .transform((url) => new URL(url).origin),
    /** Public base URL of this API, used for OAuth callback URLs. */
    API_URL: z
      .url({ error: "must be the API base URL, e.g. http://localhost:4000" })
      .default("http://localhost:4000")
      .transform((url) => url.replace(/\/+$/, "")),
    /**
     * Reverse proxies in front of the API (0 = none). Set it behind a load balancer or TLS proxy so
     * rate limits and logs see the client's IP from X-Forwarded-For instead of the proxy's.
     */
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
    JWT_SECRET: z.string({ error: "is required" }).min(32, "must be at least 32 characters"),
    /** Defaults to true, except in production, where it must be set (see the check below). */
    SEED_DEMO_DATA: booleanString.optional(),
    /**
     * Unset = never. npm run cleanup:workspaces deletes sample workspaces nobody has opened for this
     * many days (one member, no invites, only sample projects).
     */
    SAMPLE_WORKSPACE_TTL_DAYS: z.coerce.number().int().min(1).max(3650).optional(),

    DATABASE_URL: postgresUrl,
    TEST_DATABASE_URL: postgresUrl.optional(),
    /** Unset = in-memory Socket.IO adapter and rate limits. */
    REDIS_URL: redisUrl.optional(),

    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),

    GITHUB_APP_ID: z.string().optional(),
    GITHUB_APP_PRIVATE_KEY_PATH: z.string().optional(),
    GITHUB_WEBHOOK_SECRET: z.string().optional(),
    /** The App's URL name (github.com/apps/<slug>), for the install link. */
    GITHUB_APP_SLUG: z
      .string()
      .regex(/^[a-z0-9-]+$/, "must be the App's URL name, e.g. devflow-app")
      .optional(),
    /** The GitHub App's own client ID and secret (not the OAuth app's), to verify who installed it. */
    GITHUB_APP_CLIENT_ID: z.string().optional(),
    GITHUB_APP_CLIENT_SECRET: z.string().optional(),

    /** Defaults to console, except in production, where it must be set (see the check below). */
    EMAIL_PROVIDER: z.enum(["console", "smtp", "resend"]).optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(465),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    EMAIL_FROM: z.string().default("DevFlow <no-reply@devflow.local>"),
  })
  .superRefine((env, ctx) => {
    if (env.EMAIL_PROVIDER === "resend") {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_PROVIDER"],
        message: "resend is reserved for a later release; use console or smtp",
      });
    }
    if (env.EMAIL_PROVIDER === "smtp") {
      for (const key of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"] as const) {
        if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: "is required when EMAIL_PROVIDER=smtp" });
      }
    }
    // The development defaults are unsafe on a real deployment: the demo seed creates accounts whose
    // password is published, and the console provider logs live reset and invite links. In
    // production they must be chosen on purpose (docker-compose.yml opts in for the review stack).
    if (env.NODE_ENV === "production") {
      if (env.SEED_DEMO_DATA === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["SEED_DEMO_DATA"],
          message: "must be set when NODE_ENV=production (true seeds demo accounts with a published password)",
        });
      }
      if (env.EMAIL_PROVIDER === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["EMAIL_PROVIDER"],
          message: "must be set when NODE_ENV=production (console writes reset and invite links to the log)",
        });
      }
    }
  })
  .transform((env) => ({
    ...env,
    SEED_DEMO_DATA: env.SEED_DEMO_DATA ?? true,
    EMAIL_PROVIDER: env.EMAIL_PROVIDER ?? "console",
  }));

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  override name = "EnvError";
}

/**
 * Validates environment variables. Empty values count as unset, so a blank line copied from
 * `.env.example` falls back to its default or disables the optional integration.
 * Error messages name the variable but never echo its value.
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const provided = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ""),
  );
  const result = envSchema.safeParse(provided);
  if (result.success) return result.data;

  const lines = result.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`);
  throw new EnvError(`Invalid environment configuration:\n${lines.join("\n")}\nSee .env.example for every variable.`);
}

/** Loads `.env` when present (never overriding real environment variables), then validates. */
export function loadEnv(): Env {
  loadDotenv({ quiet: true });
  return parseEnv(process.env);
}
