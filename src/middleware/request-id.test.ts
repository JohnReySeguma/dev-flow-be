import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it } from "vitest";
import { resolveRequestId } from "./request-id.js";

function exchange(headers: Record<string, string> = {}) {
  const req = new IncomingMessage(new Socket());
  req.headers = headers;
  return { req, res: new ServerResponse(req) };
}

describe("resolveRequestId", () => {
  it("generates a UUID and echoes it on the response", () => {
    const { req, res } = exchange();

    const id = resolveRequestId(req, res);

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.getHeader("X-Request-Id")).toBe(id);
  });

  it("reuses a safe incoming id", () => {
    const { req, res } = exchange({ "x-request-id": "edge-1234.abc" });

    expect(resolveRequestId(req, res)).toBe("edge-1234.abc");
  });

  it("replaces an unsafe incoming id", () => {
    const { req, res } = exchange({ "x-request-id": "bad id\nwith newline" });

    expect(resolveRequestId(req, res)).not.toContain("bad id");
  });
});
