import type { Metadata } from "next";
import "./globals.css";
import { QueryProvider } from "./query-provider";
import { Header } from "./(components)/root/Header";
import { MuiThemeProvider as ThemeProvider } from "./(components)/mui-theme-provider";
import { LanguageSwitcher } from "./(components)/nav-bar/LanguageSwitcher";
import { getLanguageForServerComp } from "./lib/i18n/getLanguageForServerComp";
import { NavBar } from "./(components)/nav-bar/NavBar";
import EmotionRegistry from "./(components)/EmotionRegistry";
import localFont from "next/font/local";

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
      <body className={`${Pretendard.variable} antialiased`}>
        <EmotionRegistry>
          <ThemeProvider>          
            <QueryProvider>
              <Header language={language} />
              <NavBar />
              {children}
              <LanguageSwitcher />
            </QueryProvider>
          </ThemeProvider>
        </EmotionRegistry>          
      </body>
    </html>
  );
}
