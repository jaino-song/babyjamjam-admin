import type { Metadata, Viewport } from "next";
import "./globals.css";
import { QueryProvider } from "./query-provider";
import { ConditionalHeader } from "./(components)/root/ConditionalHeader";
import { MuiThemeProvider as ThemeProvider } from "./(components)/mui-theme-provider";
import EmotionRegistry from "./(components)/EmotionRegistry";
import localFont from "next/font/local";
import AnimatedContainer from "./(components)/root/AnimatedContainer";
import { Box } from "@mui/material";
import { LocaleProvider } from "./(components)/LocaleProvider";
import { getLocale } from "./actions/locale";
import { getCurrentUser } from "./lib/auth/cookies";
import { UserProvider } from "./(components)/providers/UserProvider";

const Pretendard = localFont({
  src: "./fonts/Pretendard.woff2",
  variable: "--font-pretendard",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Incheon Imirae Back Office",
  description: "Incheon Imirae Back Office",
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
                  <ConditionalHeader />
                  <AnimatedContainer>
                    <Box component="main" data-component="main-content" sx={{ m: 1, flexGrow: 1 }}>
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
