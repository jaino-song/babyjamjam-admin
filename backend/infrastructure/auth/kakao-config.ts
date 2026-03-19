const DEFAULT_DEVELOPMENT_KAKAO_CLIENT_ID = "dev-kakao-client-id";
const DEFAULT_DEVELOPMENT_KAKAO_CALLBACK_URL = "http://localhost:3000/auth/kakao/callback";

function isProductionLikeEnvironment() {
  return process.env["NODE_ENV"] === "production" || process.env["VERCEL_ENV"] === "preview";
}

function normalizeEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function getKakaoOAuthConfig() {
  const clientID = normalizeEnv(process.env["KAKAO_CLIENT_ID"]);
  const clientSecret = normalizeEnv(process.env["KAKAO_CLIENT_SECRET"]);
  const callbackURL = normalizeEnv(process.env["KAKAO_CALLBACK_URL"]);

  if (isProductionLikeEnvironment()) {
    if (!clientID || !callbackURL) {
      throw new Error("KAKAO_CLIENT_ID and KAKAO_CALLBACK_URL are required in production-like environments.");
    }

    return {
      clientID,
      clientSecret,
      callbackURL,
    };
  }

  return {
    clientID: clientID ?? DEFAULT_DEVELOPMENT_KAKAO_CLIENT_ID,
    clientSecret,
    callbackURL: callbackURL ?? DEFAULT_DEVELOPMENT_KAKAO_CALLBACK_URL,
  };
}
