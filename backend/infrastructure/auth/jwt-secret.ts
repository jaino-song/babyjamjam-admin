import { isDevelopmentJwtSecretAllowed } from "./runtime-environment";

const DEFAULT_DEVELOPMENT_JWT_SECRET = "your-secret-key";

export function getJwtSecret(): string {
  const configuredSecret = process.env["JWT_SECRET"]?.trim();

  if (configuredSecret) {
    return configuredSecret;
  }

  if (!isDevelopmentJwtSecretAllowed()) {
    throw new Error("JWT_SECRET is required unless the development fallback is explicitly enabled.");
  }

  return DEFAULT_DEVELOPMENT_JWT_SECRET;
}
