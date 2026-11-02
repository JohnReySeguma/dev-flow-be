import { nonEmpty, OAuthProviderError, readJson, type FetchLike, type OAuthProvider } from "./oauth.types.js";

type TokenResponse = { access_token?: string; error?: string };
type GitHubUser = { id: number; login: string; name: string | null };
type GitHubEmail = { email: string; primary: boolean; verified: boolean };

/** GitHub OAuth app flow; asks only for the profile and email addresses. */
export function createGitHubProvider(config: {
  clientId: string;
  clientSecret: string;
  fetch: FetchLike;
}): OAuthProvider {
  return {
    name: "github",

    authorizationUrl: ({ state, redirectUri, codeChallenge }) => {
      const url = new URL("https://github.com/login/oauth/authorize");
      url.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        scope: "read:user user:email",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        allow_signup: "true",
      }).toString();
      return url.toString();
    },

    async fetchProfile({ code, redirectUri, codeVerifier }) {
      const token = await readJson<TokenResponse>(
        await config.fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            code,
            redirect_uri: redirectUri,
            code_verifier: codeVerifier,
          }),
        }),
        "GitHub token exchange",
      );
      if (!token.access_token)
        throw new OAuthProviderError(`GitHub token exchange failed: ${token.error ?? "no token"}`);

      const headers = {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token.access_token}`,
        "User-Agent": "devflow-api",
      };
      const [user, emails] = await Promise.all([
        config.fetch("https://api.github.com/user", { headers }).then((r) => readJson<GitHubUser>(r, "GitHub user")),
        config
          .fetch("https://api.github.com/user/emails", { headers })
          .then((r) => readJson<GitHubEmail[]>(r, "GitHub emails")),
      ]);
      const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
      return {
        providerAccountId: String(user.id),
        email: primary?.email.toLowerCase() ?? null,
        emailVerified: Boolean(primary),
        name: nonEmpty(user.name) ?? user.login,
      };
    },
  };
}
