import jwt from "jsonwebtoken";
import { AppError } from "../../lib/errors.js";

/** Short-lived on purpose: revocation takes effect at the next refresh at the latest. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

const ISSUER = "devflow-api";
const AUDIENCE = "devflow";

export type AccessClaims = { userId: string; sessionId: string };

export function createAccessTokens(secret: string) {
  return {
    sign: ({ userId, sessionId }: AccessClaims): string =>
      jwt.sign({ sid: sessionId }, secret, {
        algorithm: "HS256",
        subject: userId,
        issuer: ISSUER,
        audience: AUDIENCE,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      }),

    /** Throws TOKEN_EXPIRED for an expired token and UNAUTHENTICATED for anything else invalid. */
    verify(token: string, { ignoreExpiration = false } = {}): AccessClaims {
      try {
        const payload = jwt.verify(token, secret, {
          algorithms: ["HS256"],
          issuer: ISSUER,
          audience: AUDIENCE,
          ignoreExpiration,
        });
        if (typeof payload === "string" || !payload.sub || typeof payload.sid !== "string") {
          throw new AppError("UNAUTHENTICATED");
        }
        return { userId: payload.sub, sessionId: payload.sid };
      } catch (error) {
        if (error instanceof jwt.TokenExpiredError) throw new AppError("TOKEN_EXPIRED", undefined, { cause: error });
        if (error instanceof AppError) throw error;
        throw new AppError("UNAUTHENTICATED", undefined, { cause: error });
      }
    },
  };
}

export type AccessTokens = ReturnType<typeof createAccessTokens>;
