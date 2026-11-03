import { readJson, type FetchLike } from "../oauth/oauth.types.js";

export type GitHubInstallation = { id: number; account: { login: string; type: string } };

type TokenResponse = { access_token?: string; error?: string };
type InstallationsPage = { total_count: number; installations: GitHubInstallation[] };

/** GitHub caps per_page at 100; nobody can reach this many installations. */
const MAX_PAGES = 10;

export class GitHubAppError extends Error {
  override name = "GitHubAppError";
}

/**
 * The GitHub App's user-to-server calls: with "Request user authorization (OAuth) during
 * installation" enabled, GitHub sends the installing user back with a code, which proves which
 * installations that person can access.
 */
export function createGitHubAppClient(config: { clientId: string; clientSecret: string; fetch: FetchLike }) {
  return {
    /** The installations the user who authorized `code` can access. */
    async userInstallations(code: string): Promise<GitHubInstallation[]> {
      const token = await readJson<TokenResponse>(
        await config.fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code }),
        }),
        "GitHub App token exchange",
      );
      if (!token.access_token) {
        throw new GitHubAppError(`GitHub App token exchange failed: ${token.error ?? "no token"}`);
      }
      const headers = {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token.access_token}`,
        "User-Agent": "devflow-api",
      };
      const installations: GitHubInstallation[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const response = await config.fetch(`https://api.github.com/user/installations?per_page=100&page=${page}`, {
          headers,
        });
        const body = await readJson<InstallationsPage>(response, "GitHub user installations");
        installations.push(...body.installations);
        if (installations.length >= body.total_count || body.installations.length === 0) break;
      }
      return installations;
    },
  };
}

export type GitHubAppClient = ReturnType<typeof createGitHubAppClient>;
