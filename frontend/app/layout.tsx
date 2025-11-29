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

  return (
    <html lang={locale}>
      <body className={Pretendard.variable} style={{ WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale' }}>
        <EmotionRegistry>
          <ThemeProvider>
            <QueryProvider>
              <LocaleProvider locale={locale}>
                <ConditionalHeader />
                <AnimatedContainer>
                  <Box component="main" sx={{ m: 1 }}>
                    {children}
                  </Box>
                </AnimatedContainer>
              </LocaleProvider>
            </QueryProvider>
          </ThemeProvider>
        </EmotionRegistry>
      </body>
    </html>
  );
}
