import argon2 from "argon2";

/** Argon2id with the library's OWASP-aligned defaults. */
export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id });

// Verifying against a real hash when the account is missing keeps response times equal,
// so login timing does not reveal which emails are registered.
let dummyHash: Promise<string> | undefined;

export async function verifyPassword(hash: string | null | undefined, password: string): Promise<boolean> {
  if (!hash) {
    dummyHash ??= hashPassword("timing-equaliser");
    await argon2.verify(await dummyHash, password);
    return false;
  }
  return argon2.verify(hash, password);
}
