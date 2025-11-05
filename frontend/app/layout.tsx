import type { Metadata } from "next";
import "./globals.css";
import { QueryProvider } from "./query-provider";
import { Header } from "./(components)/root/Header";
import { MuiThemeProvider as ThemeProvider } from "./(components)/mui-theme-provider";
import { LanguageSwitcher } from "./(components)/nav-bar/LanguageSwitcher";
import { getLanguageForServerComp } from "./lib/i18n/getLanguageForServerComp";
import { NavBar } from "./(components)/nav-bar/NavBar";

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
      <body className={`antialiased`}>
        <ThemeProvider>          
          <QueryProvider>
            <Header language={language} />
            <NavBar />
            {children}
            <LanguageSwitcher />
          </QueryProvider>
        </ThemeProvider>          
      </body>
    </html>
  );
}
