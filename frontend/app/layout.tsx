import type { Metadata } from "next";
import "./globals.css";
import { QueryProvider } from "./query-provider";
import { Header } from "./(components)/root/Header";
import { MuiThemeProvider as ThemeProvider } from "./(components)/mui-theme-provider";
import { getLanguageForServerComp } from "./lib/i18n/getLanguageForServerComp";
import EmotionRegistry from "./(components)/EmotionRegistry";
import localFont from "next/font/local";
import AnimatedContainer from "./(components)/root/AnimatedContainer";
import { Box } from "@mui/material";

const Pretendard = localFont({
  src: "./fonts/Pretendard.woff2",
  variable: "--font-pretendard",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Incheon Imirae Back Office",
  description: "Incheon Imirae Back Office",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const language = await getLanguageForServerComp();

  return (
    <html lang={language}>
      <body className={Pretendard.variable} style={{ WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale' }}>
        <EmotionRegistry>
          <ThemeProvider>
            <QueryProvider>
              <AnimatedContainer>
                <Header language={language} />
                <Box component="main" sx={{ m: 1 }}>
                  {children}
                </Box>
              </AnimatedContainer>
            </QueryProvider>
          </ThemeProvider>
        </EmotionRegistry>
      </body>
    </html>
  );
}
