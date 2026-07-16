import { redirect } from "next/navigation";
import type { ReactNode } from "react";

interface LoginLayoutProps {
  children: ReactNode;
}

export default function LoginLayout({ children }: LoginLayoutProps) {
  if (process.env.LEGACY_DEMO_MODE === "true") {
    redirect("/dashboard");
  }

  return children;
}
