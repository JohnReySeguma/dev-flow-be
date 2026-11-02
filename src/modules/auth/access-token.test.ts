import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { createAccessTokens } from "./access-token.js";

const secret = "s".repeat(32);
const tokens = createAccessTokens(secret);
const claims = { userId: "0193f1c2-0000-7000-8000-000000000001", sessionId: "0193f1c2-0000-7000-8000-000000000002" };

describe("access tokens", () => {
  it("round-trips the user and session ids", () => {
    expect(tokens.verify(tokens.sign(claims))).toEqual(claims);
  });

  it("reports an expired token as TOKEN_EXPIRED", () => {
    const expired = jwt.sign({ sid: claims.sessionId, exp: Math.floor(Date.now() / 1000) - 10 }, secret, {
      subject: claims.userId,
      issuer: "devflow-api",
      audience: "devflow",
    });

    expect(() => tokens.verify(expired)).toThrow(expect.objectContaining({ code: "TOKEN_EXPIRED" }));
    expect(tokens.verify(expired, { ignoreExpiration: true })).toEqual(claims);
  });

  it("rejects a token signed with another secret", () => {
    const forged = createAccessTokens("x".repeat(32)).sign(claims);

    expect(() => tokens.verify(forged)).toThrow(expect.objectContaining({ code: "UNAUTHENTICATED" }));
  });

  it("rejects the none algorithm", () => {
    const unsigned = jwt.sign({ sid: claims.sessionId }, "", {
      algorithm: "none",
      subject: claims.userId,
      issuer: "devflow-api",
      audience: "devflow",
    });

    expect(() => tokens.verify(unsigned)).toThrow(expect.objectContaining({ code: "UNAUTHENTICATED" }));
  });
});
