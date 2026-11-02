import { describe, expect, it, vi } from "vitest";
import { createGitHubProvider } from "./github.js";
import { createGoogleProvider } from "./google.js";

/** A fetch that answers by URL prefix and records each request. */
function fakeFetch(routes: Record<string, unknown>) {
  return vi.fn((input: string | URL | Request, _init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const match = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    return Promise.resolve(match ? Response.json(match[1]) : new Response("not found", { status: 404 }));
  });
}

const flow = { code: "the-code", redirectUri: "http://localhost:4000/cb", codeVerifier: "verifier" };

describe("GitHub provider", () => {
  const config = { clientId: "gh-id", clientSecret: "gh-secret" };

  it("builds an authorization URL with state and PKCE", () => {
    const url = new URL(
      createGitHubProvider({ ...config, fetch: fakeFetch({}) }).authorizationUrl({
        state: "s1",
        redirectUri: flow.redirectUri,
        codeChallenge: "c1",
      }),
    );

    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "gh-id",
      redirect_uri: flow.redirectUri,
      state: "s1",
      code_challenge: "c1",
      code_challenge_method: "S256",
    });
  });

  it("uses the primary verified email and falls back to the login for the name", async () => {
    const fetch = fakeFetch({
      "https://github.com/login/oauth/access_token": { access_token: "gho_x" },
      "https://api.github.com/user/emails": [
        { email: "old@acme.dev", primary: false, verified: true },
        { email: "Ada@Acme.dev", primary: true, verified: true },
      ],
      "https://api.github.com/user": { id: 42, login: "ada", name: null },
    });

    const profile = await createGitHubProvider({ ...config, fetch }).fetchProfile(flow);

    expect(profile).toEqual({ providerAccountId: "42", email: "ada@acme.dev", emailVerified: true, name: "ada" });
    expect(fetch.mock.calls[0]?.[1]?.body).toContain('"code_verifier":"verifier"');
  });

  it("reports no verified email", async () => {
    const fetch = fakeFetch({
      "https://github.com/login/oauth/access_token": { access_token: "gho_x" },
      "https://api.github.com/user/emails": [{ email: "ada@acme.dev", primary: true, verified: false }],
      "https://api.github.com/user": { id: 42, login: "ada", name: "Ada" },
    });

    expect(await createGitHubProvider({ ...config, fetch }).fetchProfile(flow)).toMatchObject({
      email: null,
      emailVerified: false,
    });
  });

  it("fails when the code is rejected", async () => {
    const fetch = fakeFetch({ "https://github.com/login/oauth/access_token": { error: "bad_verification_code" } });

    await expect(createGitHubProvider({ ...config, fetch }).fetchProfile(flow)).rejects.toThrow(
      /bad_verification_code/,
    );
  });
});

describe("Google provider", () => {
  const config = { clientId: "g-id", clientSecret: "g-secret" };

  it("reads the OpenID userinfo", async () => {
    const fetch = fakeFetch({
      "https://oauth2.googleapis.com/token": { access_token: "ya29.x" },
      "https://openidconnect.googleapis.com/v1/userinfo": {
        sub: "1077",
        email: "Ada@Gmail.com",
        email_verified: true,
        name: "Ada Lovelace",
      },
    });

    const profile = await createGoogleProvider({ ...config, fetch }).fetchProfile(flow);

    expect(profile).toEqual({
      providerAccountId: "1077",
      email: "ada@gmail.com",
      emailVerified: true,
      name: "Ada Lovelace",
    });
  });

  it("treats an unverified email as unverified", async () => {
    const fetch = fakeFetch({
      "https://oauth2.googleapis.com/token": { access_token: "ya29.x" },
      "https://openidconnect.googleapis.com/v1/userinfo": { sub: "1", email: "a@b.c", email_verified: false },
    });

    expect((await createGoogleProvider({ ...config, fetch }).fetchProfile(flow)).emailVerified).toBe(false);
  });

  it("fails on an HTTP error", async () => {
    await expect(createGoogleProvider({ ...config, fetch: fakeFetch({}) }).fetchProfile(flow)).rejects.toThrow(
      /HTTP 404/,
    );
  });
});
