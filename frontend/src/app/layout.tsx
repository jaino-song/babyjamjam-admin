import type { Metadata, Viewport } from "next";
import "./globals.css";
import { QueryProvider } from "./query-provider";
import { ConditionalHeader } from "./(components)/root/conditional-header";
import { MuiThemeProvider as ThemeProvider } from "./(components)/mui-theme-provider";
import EmotionRegistry from "./(components)/EmotionRegistry";
import localFont from "next/font/local";
import AnimatedContainer from "./(components)/root/animated-container";
import { Box } from "@mui/material";
import { LocaleProvider } from "./(components)/LocaleProvider";
import { getLocale } from "./actions/locale";
import { getCurrentUser } from "./lib/auth/cookies";
import { UserProvider } from "./(components)/providers/UserProvider";
import SplashScreen from "./(components)/splash/SplashScreen";

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
  themeColor: "#ffffff",
  width: "device-width",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  // 서버에서 user 데이터 prefetch - ConditionalHeader에서 사용
  // React cache()로 감싸져 있어 같은 request에서 중복 호출되지 않음
  const user = await getCurrentUser();

  return (
    <html lang={locale}>
      <body className={Pretendard.variable} style={{ WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale', height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <EmotionRegistry>
          <ThemeProvider>
            <QueryProvider>
              <LocaleProvider locale={locale}>
                <UserProvider user={user}>
                  <SplashScreen />
                  <ConditionalHeader />
                  <AnimatedContainer>
                    <Box component="main" data-component="main-content" sx={{ m: 1, flexGrow: 1, width: "100%" }}>
                      {children}
                    </Box>
                  </AnimatedContainer>
                </UserProvider>
              </LocaleProvider>
            </QueryProvider>
          </ThemeProvider>
        </EmotionRegistry>
      </body>
    </html>
  );
}
