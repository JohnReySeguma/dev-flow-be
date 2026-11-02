import type { Features } from "../../config/features.js";
import type { PublicConfig } from "./config.schemas.js";

/** The subset of the deployment's features the frontend needs to hide unavailable options. */
export function createConfigService(features: Features) {
  const publicConfig: PublicConfig = {
    oauth: { ...features.oauth },
    githubIntegration: features.githubIntegration,
    email: features.email.provider !== "console",
  };

  return { getPublicConfig: (): PublicConfig => publicConfig };
}

export type ConfigService = ReturnType<typeof createConfigService>;
