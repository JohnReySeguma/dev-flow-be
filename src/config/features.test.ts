import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";
import { describeFeatures, resolveFeatures } from "./features.js";

const base = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/devflow",
  JWT_SECRET: "x".repeat(32),
};
const github = {
  GITHUB_APP_ID: "123",
  GITHUB_WEBHOOK_SECRET: "whsec",
  GITHUB_APP_PRIVATE_KEY_PATH: "./app.pem",
  GITHUB_APP_SLUG: "devflow-app",
  GITHUB_APP_CLIENT_ID: "Iv1.abc",
  GITHUB_APP_CLIENT_SECRET: "app-secret",
};

describe("resolveFeatures", () => {
  it("disables every optional integration when nothing is configured", () => {
    const features = resolveFeatures(parseEnv(base), () => true);

    expect(features).toEqual({
      oauth: { github: false, google: false },
      githubIntegration: false,
      email: { provider: "console" },
      redis: false,
    });
    expect(describeFeatures(features)).toMatchObject({ realtime: "in-memory", email: "console" });
  });

  it("enables an OAuth provider only when both its id and secret are set", () => {
    const features = resolveFeatures(
      parseEnv({ ...base, GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret", GOOGLE_CLIENT_ID: "id" }),
    );

    expect(features.oauth).toEqual({ github: true, google: false });
  });

  it("enables the GitHub integration when the app id, slug, credentials, secret and key file are present", () => {
    expect(resolveFeatures(parseEnv({ ...base, ...github }), () => true).githubIntegration).toBe(true);
  });

  it.each(["GITHUB_APP_SLUG", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET"])(
    "disables the GitHub integration without %s, needed to link installations",
    (name) => {
      expect(resolveFeatures(parseEnv({ ...base, ...github, [name]: "" }), () => true).githubIntegration).toBe(false);
    },
  );

  it("disables the GitHub integration when the key file is missing or empty", () => {
    expect(resolveFeatures(parseEnv({ ...base, ...github }), () => false).githubIntegration).toBe(false);
    expect(
      resolveFeatures(parseEnv({ ...base, ...github, GITHUB_APP_PRIVATE_KEY_PATH: "/dev/null" })).githubIntegration,
    ).toBe(false);
  });

  it("reports redis and smtp when configured", () => {
    const features = resolveFeatures(
      parseEnv({
        ...base,
        REDIS_URL: "redis://localhost:6379",
        EMAIL_PROVIDER: "smtp",
        SMTP_HOST: "smtp.example.com",
        SMTP_USER: "u",
        SMTP_PASS: "p",
      }),
    );

    expect(features.redis).toBe(true);
    expect(describeFeatures(features)).toMatchObject({ realtime: "redis", email: "smtp" });
  });
});
