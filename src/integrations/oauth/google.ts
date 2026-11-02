import { nonEmpty, OAuthProviderError, readJson, type FetchLike, type OAuthProvider } from "./oauth.types.js";

type TokenResponse = { access_token?: string; error?: string };
type GoogleUserInfo = { sub: string; email?: string; email_verified?: boolean; name?: string };

/** Google OpenID Connect with PKCE; asks only for the basic profile and email. */
export function createGoogleProvider(config: {
  clientId: string;
  clientSecret: string;
  fetch: FetchLike;
}): OAuthProvider {
  return {
    name: "google",

    authorizationUrl: ({ state, redirectUri, codeChallenge }) => {
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        prompt: "select_account",
      }).toString();
      return url.toString();
    },

    async fetchProfile({ code, redirectUri, codeVerifier }) {
      const token = await readJson<TokenResponse>(
        await config.fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            code,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
            code_verifier: codeVerifier,
          }),
        }),
        "Google token exchange",
      );
      if (!token.access_token)
        throw new OAuthProviderError(`Google token exchange failed: ${token.error ?? "no token"}`);

      const info = await readJson<GoogleUserInfo>(
        await config.fetch("https://openidconnect.googleapis.com/v1/userinfo", {
          headers: { Authorization: `Bearer ${token.access_token}` },
        }),
        "Google userinfo",
      );
      const email = info.email?.toLowerCase() ?? null;
      return {
        providerAccountId: info.sub,
        email,
        emailVerified: Boolean(email && info.email_verified),
        name: nonEmpty(info.name) ?? email?.split("@")[0] ?? "Google user",
      };
    },
  };
}
