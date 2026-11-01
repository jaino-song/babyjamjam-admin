import { NextResponse } from "next/server";

const RETRY_AFTER_SECONDS = "5";

const BODY = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>서버에 연결할 수 없어요</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f6f8fb;color:#12366a}
main{max-width:360px;margin:24px;padding:32px 24px;border-radius:16px;background:#fff;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.08)}
h1{margin:0 0 12px;font-size:20px}
p{margin:0 0 24px;font-size:14px;line-height:1.6;color:#4a5568}
a{display:inline-block;padding:10px 24px;border-radius:10px;background:#12366a;color:#fff;font-size:14px;text-decoration:none}
</style>
</head>
<body>
<main role="alert" data-component="desktop_proxy_auth-unavailable">
<h1>서버에 연결할 수 없어요</h1>
<p>서버에 연결할 수 없어 로그인 상태를 확인하지 못했어요. 로그인 정보는 그대로 유지되니 잠시 후 다시 시도해 주세요.</p>
<a href="" data-component="desktop_proxy_auth-unavailable_retry">다시 시도</a>
</main>
</body>
</html>`;

/**
 * Answer for a request whose session could not be verified because the auth
 * backend is unavailable (timeout, network failure, 5xx). It deliberately sets
 * and clears no cookies: the session is not known to be invalid, so the user
 * must not be signed out or sent to /login. The retry link is an empty href,
 * which re-requests the same URL.
 */
export function createAuthServiceUnavailableResponse(): NextResponse {
  return new NextResponse(BODY, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": RETRY_AFTER_SECONDS,
    },
  });
}
