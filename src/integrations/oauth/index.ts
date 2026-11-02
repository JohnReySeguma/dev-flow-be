import type { Env } from "../../config/env.js";
import { createGitHubProvider } from "./github.js";
import { createGoogleProvider } from "./google.js";
import type { FetchLike, OAuthProvider, OAuthProviderName } from "./oauth.types.js";

export type { OAuthProfile, OAuthProvider, OAuthProviderName } from "./oauth.types.js";

export type OAuthProviders = Partial<Record<OAuthProviderName, OAuthProvider>>;

/** Only providers with both a client id and secret are enabled (the same rule as GET /config). */
export function createOAuthProviders(env: Env, fetchImpl: FetchLike = fetch): OAuthProviders {
  return {
    ...(env.GITHUB_CLIENT_ID &&
      env.GITHUB_CLIENT_SECRET && {
        github: createGitHubProvider({
          clientId: env.GITHUB_CLIENT_ID,
          clientSecret: env.GITHUB_CLIENT_SECRET,
          fetch: fetchImpl,
        }),
      }),
    ...(env.GOOGLE_CLIENT_ID &&
      env.GOOGLE_CLIENT_SECRET && {
        google: createGoogleProvider({
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          fetch: fetchImpl,
        }),
      }),
  };
}
