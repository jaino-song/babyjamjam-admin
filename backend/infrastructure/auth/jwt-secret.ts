import { isProductionLikeEnvironment } from "./runtime-environment";

const DEFAULT_DEVELOPMENT_JWT_SECRET = "your-secret-key";

export function getJwtSecret(): string {
  const configuredSecret = process.env["JWT_SECRET"]?.trim();

  if (configuredSecret) {
    return configuredSecret;
  }

  if (isProductionLikeEnvironment()) {
    throw new Error("JWT_SECRET is required in production-like environments.");
  }

  return DEFAULT_DEVELOPMENT_JWT_SECRET;
}
