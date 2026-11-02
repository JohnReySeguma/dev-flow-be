import { z } from "zod";
import { userProfile } from "../users/users.schemas.js";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Enter a valid email address." }).max(254));

const newPassword = z.string().min(8, "Use at least 8 characters.").max(128, "Use at most 128 characters.");

export const signupBody = z
  .object({
    name: z.string().trim().min(1, "Tell us what to call you.").max(48, "Use at most 48 characters."),
    email,
    password: newPassword,
  })
  .meta({
    id: "SignupRequest",
    example: { name: "Ada Lovelace", email: "ada@acme.dev", password: "correct horse battery" },
  });

export const loginBody = z
  .object({ email, password: z.string().min(1, "Password is required.").max(128) })
  .meta({ id: "LoginRequest", example: { email: "demo@devflow.local", password: "devflow-demo" } });

export const forgotPasswordBody = z
  .object({ email })
  .meta({ id: "ForgotPasswordRequest", example: { email: "demo@devflow.local" } });

export const resetPasswordBody = z
  .object({ token: z.string().min(1, "The reset token is missing.").max(256), password: newPassword })
  .meta({
    id: "ResetPasswordRequest",
    example: { token: "Zq3nXl0w8bJ7r2mYc5dV1aKf9sHt4uPo6eLgQiWjNxE", password: "a new long password" },
  });

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
export type ForgotPasswordInput = z.infer<typeof forgotPasswordBody>;
export type ResetPasswordInput = z.infer<typeof resetPasswordBody>;
export type AuthMe = z.infer<typeof authMeResponse>;
