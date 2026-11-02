import type { Request, RequestHandler } from "express";
import { AppError } from "../../lib/errors.js";
import { authOf } from "../../middleware/require-auth.js";
import { clearSessionCookies, readSessionCookies, setSessionCookies } from "./auth.cookies.js";
import type { LoginInput, SignupInput } from "./auth.schemas.js";
import type { AuthService } from "./auth.service.js";
import type { RequestMeta } from "./auth.types.js";

const metaOf = (req: Request): RequestMeta => ({ userAgent: req.get("user-agent") });

export function createAuthController(auth: AuthService) {
  const signup: RequestHandler = async (req, res) => {
    const { session, me } = await auth.signup(req.body as SignupInput, metaOf(req));
    setSessionCookies(res, session);
    res.status(201).json(me);
  };

  const login: RequestHandler = async (req, res) => {
    const { session, me } = await auth.login(req.body as LoginInput, metaOf(req));
    setSessionCookies(res, session);
    res.json(me);
  };

  const refresh: RequestHandler = async (req, res) => {
    const { refreshToken } = readSessionCookies(req);
    try {
      if (!refreshToken) throw new AppError("UNAUTHENTICATED");
      setSessionCookies(res, await auth.refresh(refreshToken));
    } catch (error) {
      // A refresh that fails means signed out: drop the dead cookies too.
      clearSessionCookies(res);
      throw error;
    }
    res.status(204).end();
  };

  const logout: RequestHandler = async (req, res) => {
    await auth.logout(readSessionCookies(req));
    clearSessionCookies(res);
    res.status(204).end();
  };

  const me: RequestHandler = async (req, res) => {
    res.set("Cache-Control", "no-store").json(await auth.me(authOf(req).userId));
  };

  return { signup, login, refresh, logout, me };
}
