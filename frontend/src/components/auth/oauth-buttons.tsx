"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function KakaoIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("h-5 w-5", className)}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 3C6.486 3 2 6.481 2 10.795c0 2.747 1.82 5.158 4.566 6.55-.157.55-1 3.531-1.033 3.768 0 0-.021.181.096.249a.327.327 0 0 0 .259.014c.331-.047 3.821-2.502 4.426-2.926.553.08 1.119.122 1.686.122 5.514 0 10-3.481 10-7.795S17.514 3 12 3z" />
    </svg>
  );
}

// Google Icon Component (since MUI icons won't be used)
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("h-5 w-5", className)}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

interface OAuthButtonsProps {
  disabled?: boolean;
  className?: string;
}

export function OAuthButtons({ disabled, className }: OAuthButtonsProps) {
  const handleKakaoLogin = () => {
    window.location.href = "/api/auth/kakao";
  };

  const handleGoogleLogin = () => {
    window.location.href = "/api/auth/google";
  };

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <Button
        type="button"
        variant="kakao"
        size="lg"
        className="w-full"
        onClick={handleKakaoLogin}
        disabled={disabled}
      >
        <KakaoIcon />
        카카오로 로그인
      </Button>
      <Button
        type="button"
        variant="google"
        size="lg"
        className="w-full"
        onClick={handleGoogleLogin}
        disabled
      >
        <GoogleIcon />
        Google로 로그인
      </Button>
    </div>
  );
}
