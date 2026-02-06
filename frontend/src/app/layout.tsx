import type { Metadata, Viewport } from "next";
import "./globals.css";
import { QueryProvider } from "./query-provider";
import localFont from "next/font/local";
import { LocaleProvider } from "./(components)/LocaleProvider";
import { getLocale } from "./actions/locale";
import { getCurrentUser } from "./lib/auth/cookies";
import { UserProvider } from "./(components)/providers/UserProvider";
import { NotificationPermissionPrompt } from "./(components)/notification-permission-prompt";
import { Toaster } from "@/components/ui/toaster";
import { MobileBottomNav } from "./(components)/root/mobile-bottom-nav";
import { V3Sidebar } from "./(components)/v3/V3Sidebar";
import { V3MobileHeader } from "./(components)/v3/V3MobileHeader";
import { V3MainContent } from "./(components)/v3/V3MainContent";

const Pretendard = localFont({
  src: "./fonts/Pretendard.woff2",
  variable: "--font-pretendard",
  display: "swap",
});

export const metadata: Metadata = {
  title: "인천 아이미래로 백오피스",
  description: "인천 아이미래로 업무 관리 시스템",
  manifest: "/manifest.json",
  icons: {
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "인천 아이미래로",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#12366a",
  width: "device-width",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const user = await getCurrentUser();

  return (
    <html lang={locale}>
      <body className={`${Pretendard.variable} antialiased min-h-screen`}>
        <QueryProvider>
          <LocaleProvider locale={locale}>
            <UserProvider user={user}>
              <NotificationPermissionPrompt />
              <V3Sidebar />
              <V3MobileHeader />
              <V3MainContent>
                {children}
              </V3MainContent>
              <Toaster />
              <MobileBottomNav />
            </UserProvider>
          </LocaleProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
