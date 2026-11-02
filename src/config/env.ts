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
    CORS_ORIGIN: z
      .url({ error: "must be the frontend URL, e.g. http://localhost:3000" })
      .default("http://localhost:3000"),
    /** Public base URL of this API, used for OAuth callback URLs. */
    API_URL: z.url({ error: "must be the API base URL, e.g. http://localhost:4000" }).default("http://localhost:4000"),
    JWT_SECRET: z.string({ error: "is required" }).min(32, "must be at least 32 characters"),
    SEED_DEMO_DATA: booleanString.default(true),

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

    EMAIL_PROVIDER: z.enum(["console", "smtp", "resend"]).default("console"),
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
  });

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
