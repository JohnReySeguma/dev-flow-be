import type { Request, RequestHandler } from "express";
import { AppError } from "../../lib/errors.js";
import { identityOf } from "../../middleware/require-auth.js";
import {
  clearOAuthStateCookie,
  clearSessionCookies,
  readOAuthStateCookie,
  readSessionCookies,
  setOAuthStateCookie,
  setSessionCookies,
} from "./auth.cookies.js";
import type { ForgotPasswordInput, LoginInput, ResetPasswordInput, SignupInput } from "./auth.schemas.js";
import type { AuthService } from "./auth.service.js";
import type { RequestMeta } from "./auth.types.js";
import { OAUTH_STATE_TTL_SECONDS, OAuthFlowError, type OAuthService } from "./oauth.service.js";
import type { PasswordResetService } from "./password-reset.service.js";

const metaOf = (req: Request): RequestMeta => ({ userAgent: req.get("user-agent") });

export function createAuthController(deps: {
  auth: AuthService;
  passwords: PasswordResetService;
  oauth: OAuthService;
  /** The frontend origin OAuth redirects back to. */
  frontendUrl: string;
}) {
  const { auth, passwords, oauth, frontendUrl } = deps;

  const providerOf = (req: Request) => {
    const provider = String(req.params.provider);
    if (!oauth.isEnabled(provider)) throw new AppError("NOT_FOUND", "That sign-in provider is not enabled.");
    return provider;
  };

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

  const forgotPassword: RequestHandler = (req, res) => {
    // Not awaited on purpose: the answer must not depend on whether the account exists.
    void passwords.requestReset((req.body as ForgotPasswordInput).email);
    res.status(202).end();
  };

  const resetPassword: RequestHandler = async (req, res) => {
    const { token, password } = req.body as ResetPasswordInput;
    await passwords.reset(token, password);
    res.status(204).end();
  };

  const startOAuth: RequestHandler = (req, res) => {
    const { url, stateToken } = oauth.start(providerOf(req), req.query.redirect);
    setOAuthStateCookie(res, stateToken, OAUTH_STATE_TTL_SECONDS);
    res.redirect(302, url);
  };

  /** Always ends in a browser redirect to the frontend, never in a JSON error. */
  const finishOAuth: RequestHandler = async (req, res) => {
    const provider = providerOf(req);
    clearOAuthStateCookie(res);
    try {
      const { session, redirect } = await oauth.finish(provider, req.query, readOAuthStateCookie(req), metaOf(req));
      setSessionCookies(res, session);
      res.redirect(302, `${frontendUrl}${redirect}`);
    } catch (error) {
      const code = error instanceof OAuthFlowError ? error.code : "oauth_failed";
      if (!(error instanceof OAuthFlowError)) req.log.error({ err: error }, "oauth sign-in failed");
      res.redirect(302, `${frontendUrl}/login?error=${code}`);
    }
  };

  const me: RequestHandler = async (req, res) => {
    res.set("Cache-Control", "no-store").json(await auth.me(identityOf(req).userId));
  };

  return { signup, login, refresh, logout, forgotPassword, resetPassword, startOAuth, finishOAuth, me };
}
