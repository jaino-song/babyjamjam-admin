"use client";
import { Button, ButtonGroup } from "@mui/material";
import { useRouter } from "next/navigation";
import Cookies from "js-cookie";

export const LanguageSwitcher = () => {
  const router = useRouter();
  const currentLang = Cookies.get("language") || "ko";

  const handleLanguageChange = (lang: string) => {
    // Set cookie with 1 year expiry
    Cookies.set("language", lang, { expires: 365 });
    // Refresh the page to re-render with new language
    router.refresh();
  };

  return (
    <ButtonGroup size="small" variant="outlined" sx={{ height: '3%' }}>
      <Button onClick={() => handleLanguageChange("en")} variant={currentLang === "en" ? "contained" : "outlined"} sx={{ width: '50%', borderRadius: '10px 0 0 10px' }}>English</Button>
      <Button onClick={() => handleLanguageChange("ko")} variant={currentLang === "ko" ? "contained" : "outlined"} sx={{ width: '50%', borderRadius: '0 10px 10px 0' }}>한국어</Button>
    </ButtonGroup>
  );
};

