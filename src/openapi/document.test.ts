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
      "/config",
      "/health",
      "/health/ready",
      "/integrations/github/webhook",
      "/invites/{token}",
      "/invites/{token}/accept",
      "/me",
      "/me/tokens",
      "/me/tokens/{id}",
      "/workspaces",
      "/workspaces/{workspace}",
      "/workspaces/{workspace}/bootstrap",
      "/workspaces/{workspace}/demo/reset",
      "/workspaces/{workspace}/invites",
      "/workspaces/{workspace}/invites/{id}/resend",
      "/workspaces/{workspace}/issues/{issueKey}",
      "/workspaces/{workspace}/issues/{issueKey}/comments",
      "/workspaces/{workspace}/issues/{issueKey}/move",
      "/workspaces/{workspace}/leave",
      "/workspaces/{workspace}/members",
      "/workspaces/{workspace}/members/{id}",
      "/workspaces/{workspace}/projects",
      "/workspaces/{workspace}/projects/{key}",
      "/workspaces/{workspace}/projects/{key}/issues",
      "/workspaces/{workspace}/projects/{key}/reports/history",
      "/workspaces/{workspace}/projects/{key}/reports/velocity",
      "/workspaces/{workspace}/projects/{key}/snapshot",
      "/workspaces/{workspace}/projects/{key}/sprints",
      "/workspaces/{workspace}/projects/{key}/statuses",
      "/workspaces/{workspace}/projects/{key}/statuses/order",
      "/workspaces/{workspace}/projects/{key}/statuses/{id}",
      "/workspaces/{workspace}/sprints/{id}",
      "/workspaces/{workspace}/sprints/{id}/burndown",
      "/workspaces/{workspace}/sprints/{id}/complete",
      "/workspaces/{workspace}/sprints/{id}/start",
    ]);
  });

  it("documents the 429 on every rate-limited operation, i.e. all but the health checks", () => {
    const operations = Object.entries(document.paths ?? {}).flatMap(([path, item]) =>
      (["get", "put", "post", "delete", "patch"] as const)
        .filter((method) => item[method])
        .map((method) => ({ path, method, limited: "429" in (item[method]?.responses ?? {}) })),
    );

    expect(operations.filter((op) => op.limited === op.path.startsWith("/health"))).toEqual([]);
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
