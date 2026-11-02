import { z } from "zod";
import { userProfile } from "../users/users.schemas.js";
import { workspaceResponse } from "../workspace/workspace.schemas.js";

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
    example: { name: "Ada Lovelace", email: "ada@acme.dev", password: "YOUR_PASSWORD" },
  });

export const loginBody = z
  .object({ email, password: z.string().min(1, "Password is required.").max(128) })
  .meta({ id: "LoginRequest", example: { email: "demo@devflow.local", password: "YOUR_PASSWORD" } });

export const forgotPasswordBody = z
  .object({ email })
  .meta({ id: "ForgotPasswordRequest", example: { email: "demo@devflow.local" } });

export const resetPasswordBody = z
  .object({ token: z.string().min(1, "The reset token is missing.").max(256), password: newPassword })
  .meta({
    id: "ResetPasswordRequest",
    example: { token: "RESET_TOKEN_FROM_EMAIL", password: "YOUR_NEW_PASSWORD" },
  });

export const authMeResponse = z
  .object({
    user: userProfile,
    workspaces: z.array(workspaceResponse).meta({
      description: "Every workspace the user belongs to, with their role in each, oldest membership first.",
    }),
  })
  .meta({
    id: "AuthMe",
    example: { user: userProfile.meta()?.example, workspaces: [workspaceResponse.meta()?.example] },
  });

export type SignupInput = z.infer<typeof signupBody>;
export type LoginInput = z.infer<typeof loginBody>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordBody>;
export type ResetPasswordInput = z.infer<typeof resetPasswordBody>;
export type AuthMe = z.infer<typeof authMeResponse>;
