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
      "/auth/password/forgot",
      "/auth/password/reset",
      "/auth/refresh",
      "/auth/signup",
      "/config",
      "/health",
      "/health/ready",
    ]);
  });

  it("gives every component schema an example", () => {
    const schemas = Object.entries(document.components?.schemas ?? {});

    expect(schemas.length).toBeGreaterThan(0);
    for (const [name, schema] of schemas) {
      expect({ name, hasExample: "example" in schema }).toEqual({ name, hasExample: true });
    }
  });

  it("matches the committed docs/openapi.json", () => {
    const committed = readFileSync(new URL("../../docs/openapi.json", import.meta.url), "utf8");

    expect(committed, "docs/openapi.json is stale: run `npm run openapi:generate`").toBe(serializeOpenApi(document));
  });
});
