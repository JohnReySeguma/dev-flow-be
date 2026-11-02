import { z } from "zod";
import { userProfile } from "../users/users.schemas.js";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Enter a valid email address." }).max(254));

export const signupBody = z
  .object({
    name: z.string().trim().min(1, "Tell us what to call you.").max(48, "Use at most 48 characters."),
    email,
    password: z.string().min(8, "Use at least 8 characters.").max(128, "Use at most 128 characters."),
  })
  .meta({
    id: "SignupRequest",
    example: { name: "Ada Lovelace", email: "ada@acme.dev", password: "correct horse battery" },
  });

export const loginBody = z
  .object({ email, password: z.string().min(1, "Password is required.").max(128) })
  .meta({ id: "LoginRequest", example: { email: "demo@devflow.local", password: "devflow-demo" } });

export const authMeResponse = z
  .object({
    user: userProfile,
    workspace: z.object({ id: z.uuid(), name: z.string() }),
  })
  .meta({
    id: "AuthMe",
    example: {
      user: userProfile.meta()?.example,
      workspace: { id: "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e00", name: "Acme Inc" },
    },
  });

export type SignupInput = z.infer<typeof signupBody>;
export type LoginInput = z.infer<typeof loginBody>;
export type AuthMe = z.infer<typeof authMeResponse>;
