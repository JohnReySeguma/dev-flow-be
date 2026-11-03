import { statSync } from "node:fs";
import type { Env } from "./env.js";

/** Which optional integrations this deployment can use, derived once from the environment. */
export type Features = {
  oauth: { github: boolean; google: boolean };
  githubIntegration: boolean;
  email: { provider: "console" | "smtp" };
  /** Redis-backed Socket.IO adapter and rate limits; in-memory when false. */
  redis: boolean;
};

/** True for a non-empty regular file. Only stats the path: the key itself is never read here. */
function isNonEmptyFile(path: string): boolean {
  try {
    const stats = statSync(path);
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}

export function resolveFeatures(env: Env, hasKeyFile: (path: string) => boolean = isNonEmptyFile): Features {
  const keyPath = env.GITHUB_APP_PRIVATE_KEY_PATH;
  return {
    oauth: {
      github: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
      google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    },
    // Docker mounts /dev/null when no key is provided, which counts as missing. Linking an
    // installation to a workspace also needs the App's slug and its own OAuth credentials.
    githubIntegration: Boolean(
      env.GITHUB_APP_ID &&
      env.GITHUB_WEBHOOK_SECRET &&
      env.GITHUB_APP_SLUG &&
      env.GITHUB_APP_CLIENT_ID &&
      env.GITHUB_APP_CLIENT_SECRET &&
      keyPath &&
      hasKeyFile(keyPath),
    ),
    email: { provider: env.EMAIL_PROVIDER === "smtp" ? "smtp" : "console" },
    redis: Boolean(env.REDIS_URL),
  };
}

/** One log-friendly line per mode, e.g. `realtime: in-memory`. */
export function describeFeatures(features: Features): Record<string, string> {
  const onOff = (enabled: boolean) => (enabled ? "enabled" : "disabled");
  return {
    realtime: features.redis ? "redis" : "in-memory",
    rateLimits: features.redis ? "redis" : "in-memory",
    email: features.email.provider,
    oauthGithub: onOff(features.oauth.github),
    oauthGoogle: onOff(features.oauth.google),
    githubIntegration: onOff(features.githubIntegration),
  };
}
