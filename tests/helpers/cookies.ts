import type { Response } from "supertest";

export const FRONTEND_ORIGIN = "http://localhost:3000";

/** Parsed `Set-Cookie` headers: name → { value, attributes }. */
export function setCookies(res: Response): Record<string, { value: string; attributes: string }> {
  const header = res.headers["set-cookie"] as string[] | string | undefined;
  const list = Array.isArray(header) ? header : header ? [header] : [];
  return Object.fromEntries(
    list.map((cookie) => {
      const [pair = "", ...attributes] = cookie.split(";");
      const index = pair.indexOf("=");
      return [pair.slice(0, index).trim(), { value: pair.slice(index + 1), attributes: attributes.join(";").trim() }];
    }),
  );
}

/**
 * A `Cookie` request header carrying the session cookies from a response. Needed because
 * Supertest will not resend `Secure` cookies over plain http.
 */
export function sessionCookieHeader(res: Response): string {
  return Object.entries(setCookies(res))
    .filter(([, cookie]) => cookie.value !== "")
    .map(([name, cookie]) => `${name}=${cookie.value}`)
    .join("; ");
}
