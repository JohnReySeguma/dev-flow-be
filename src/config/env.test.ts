import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "./env.js";

const required = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/devflow",
  JWT_SECRET: "a".repeat(32),
};

describe("parseEnv", () => {
  it("applies defaults when only required variables are set", () => {
    const env = parseEnv(required);

    expect(env).toMatchObject({
      NODE_ENV: "development",
      PORT: 4000,
      CORS_ORIGIN: "http://localhost:3000",
      SEED_DEMO_DATA: true,
      EMAIL_PROVIDER: "console",
    });
    expect(env.REDIS_URL).toBeUndefined();
  });

  it("treats empty values as unset", () => {
    const env = parseEnv({ ...required, REDIS_URL: "", PORT: " ", GITHUB_APP_ID: "" });

    expect(env.REDIS_URL).toBeUndefined();
    expect(env.PORT).toBe(4000);
    expect(env.GITHUB_APP_ID).toBeUndefined();
  });

  it("coerces numbers and booleans", () => {
    const env = parseEnv({ ...required, PORT: "8080", SEED_DEMO_DATA: "false" });

    expect(env.PORT).toBe(8080);
    expect(env.SEED_DEMO_DATA).toBe(false);
  });

  it("normalises URLs written with a trailing slash", () => {
    const env = parseEnv({ ...required, CORS_ORIGIN: "https://app.example/", API_URL: "https://api.example/" });

    expect(env.CORS_ORIGIN).toBe("https://app.example");
    expect(env.API_URL).toBe("https://api.example");
  });

  it("makes production choose the demo seed and email provider explicitly", () => {
    const production = () => parseEnv({ ...required, NODE_ENV: "production" });
    expect(production).toThrow(/SEED_DEMO_DATA: must be set/);
    expect(production).toThrow(/EMAIL_PROVIDER: must be set/);

    const env = parseEnv({ ...required, NODE_ENV: "production", SEED_DEMO_DATA: "false", EMAIL_PROVIDER: "console" });
    expect(env).toMatchObject({ SEED_DEMO_DATA: false, EMAIL_PROVIDER: "console" });
  });

  it("names every missing required variable", () => {
    expect(() => parseEnv({})).toThrow(EnvError);
    expect(() => parseEnv({})).toThrow(/DATABASE_URL: /);
    expect(() => parseEnv({})).toThrow(/JWT_SECRET: is required/);
  });

  it("rejects a short JWT secret without echoing it", () => {
    const secret = "short-secret-value";
    let message = "";
    try {
      parseEnv({ ...required, JWT_SECRET: secret });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/JWT_SECRET: must be at least 32 characters/);
    expect(message).not.toContain(secret);
  });

  it("rejects a non-postgres database URL", () => {
    expect(() => parseEnv({ ...required, DATABASE_URL: "mysql://localhost/devflow" })).toThrow(
      /DATABASE_URL: must be a postgresql:\/\/ URL/,
    );
  });

  it("requires SMTP credentials when the smtp provider is selected", () => {
    expect(() => parseEnv({ ...required, EMAIL_PROVIDER: "smtp" })).toThrow(
      /SMTP_HOST[\s\S]*SMTP_USER[\s\S]*SMTP_PASS/,
    );
    expect(
      parseEnv({ ...required, EMAIL_PROVIDER: "smtp", SMTP_HOST: "smtp.example.com", SMTP_USER: "u", SMTP_PASS: "p" })
        .EMAIL_PROVIDER,
    ).toBe("smtp");
  });

  it("rejects the reserved resend provider", () => {
    expect(() => parseEnv({ ...required, EMAIL_PROVIDER: "resend" })).toThrow(/resend is reserved/);
  });
});
