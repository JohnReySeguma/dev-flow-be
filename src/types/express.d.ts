import type { AuthContext, Identity } from "../modules/auth/auth.types.js";

declare global {
  namespace Express {
    // Declaration merging only works with an interface.
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface Request {
      /** Set by `requireAuth`; absent on public routes. */
      identity?: Identity;
      /** Set by `requireMembership` on /workspaces/:ws routes: the caller inside that workspace. */
      auth?: AuthContext;
    }
  }
}
