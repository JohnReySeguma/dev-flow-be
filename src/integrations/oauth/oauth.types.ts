export type OAuthProviderName = "github" | "google";

/** What DevFlow needs from a provider's account, normalised across providers. */
export type OAuthProfile = {
  providerAccountId: string;
  /** Null when the provider shares no email. */
  email: string | null;
  emailVerified: boolean;
  name: string;
};

export type OAuthProvider = {
  readonly name: OAuthProviderName;
  authorizationUrl: (input: { state: string; redirectUri: string; codeChallenge: string }) => string;
  /** Exchanges the authorization code and loads the account. Throws on any provider failure. */
  fetchProfile: (input: { code: string; redirectUri: string; codeVerifier: string }) => Promise<OAuthProfile>;
};

export type FetchLike = typeof fetch;

export class OAuthProviderError extends Error {
  override name = "OAuthProviderError";
}

export async function readJson<T>(response: Response, what: string): Promise<T> {
  if (!response.ok) throw new OAuthProviderError(`${what} failed with HTTP ${response.status}`);
  return (await response.json()) as T;
}

/** Trimmed value, or undefined when missing or blank. */
export function nonEmpty(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}
