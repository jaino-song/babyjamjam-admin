import type { Metadata, Viewport } from "next";
import "../globals.css";
import localFont from "next/font/local";

// Minimal root layout for no-login public pages opened from SMS links (제공기록지).
// Deliberately excludes the admin app shell: no providers, no V3 layout components,
// and no PWA manifest/appleWebApp metadata, so the form stays light and can never
// be captured by the authenticated app shell.

const Pretendard = localFont({
  src: "../fonts/Pretendard.woff2",
  variable: "--font-pretendard",
  display: "swap",
});

export const metadata: Metadata = {
  title: "서비스 제공기록지",
  description: "아가잼잼 서비스 제공기록지 작성",
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#12366a",
  width: "device-width",
};

export default function PublicLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className={`${Pretendard.variable} antialiased min-h-screen bg-v3-dim-white`}>
        {children}
      </body>
    </html>
  );
}
