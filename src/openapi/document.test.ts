import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildOpenApiDocument, serializeOpenApi } from "./document.js";

const document = buildOpenApiDocument();

describe("OpenAPI document", () => {
  it("documents every route the app serves", () => {
    expect(Object.keys(document.paths ?? {}).sort()).toEqual([
      "/auth/login",
      "/auth/logout",
      "/auth/me",
      "/auth/oauth/{provider}",
      "/auth/oauth/{provider}/callback",
      "/auth/password/forgot",
      "/auth/password/reset",
      "/auth/refresh",
      "/auth/signup",
      "/bootstrap",
      "/config",
      "/health",
      "/health/ready",
      "/invites/{token}",
      "/invites/{token}/accept",
      "/issues/{issueKey}",
      "/issues/{issueKey}/comments",
      "/issues/{issueKey}/move",
      "/me",
      "/me/tokens",
      "/me/tokens/{id}",
      "/projects",
      "/projects/{key}",
      "/projects/{key}/issues",
      "/projects/{key}/snapshot",
      "/projects/{key}/statuses",
      "/projects/{key}/statuses/order",
      "/projects/{key}/statuses/{id}",
      "/workspace",
      "/workspace/invites",
      "/workspace/invites/{id}/resend",
      "/workspace/members",
      "/workspace/members/{id}",
    ]);
  });

  it("gives every component schema an example", () => {
    const schemas = Object.entries(document.components?.schemas ?? {});

    expect(schemas.length).toBeGreaterThan(0);
    for (const [name, schema] of schemas) {
      expect({ name, hasExample: "example" in schema }).toEqual({ name, hasExample: true });
    }
  });

  it("uses obvious placeholders, never realistic values, for credential examples", () => {
    // Secret scanners (e.g. GitGuardian) flag realistic-looking example secrets in committed files.
    const credentialKeys = /^(password|secret|token|clientSecret|client_secret|apiKey)$/i;
    const offending: string[] = [];
    const visit = (value: unknown, path: string) => {
      if (Array.isArray(value)) {
        value.forEach((item, i) => {
          visit(item, `${path}[${i}]`);
        });
      } else if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          if (credentialKeys.test(key) && typeof child === "string" && !/^(dfp_)?[A-Z_]+$/.test(child)) {
            offending.push(`${path}.${key}`);
          }
          visit(child, `${path}.${key}`);
        }
      }
    };
    visit(document, "$");

    expect(offending).toEqual([]);
  });

  it("matches the committed docs/openapi.json", () => {
    const committed = readFileSync(new URL("../../docs/openapi.json", import.meta.url), "utf8");

    expect(committed, "docs/openapi.json is stale: run `npm run openapi:generate`").toBe(serializeOpenApi(document));
  });
});
