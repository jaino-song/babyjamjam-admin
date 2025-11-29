import Link from "next/link";
import { Box, Button, Typography } from "@mui/material";
import { t } from "@/app/lib/i18n/translations";
import { getLocale } from "@/app/actions/locale";
import { getCurrentUser } from "./lib/auth/cookies";

export default async function Home() {
  const locale = await getLocale();
  const token = await getCurrentUser();
  const redirectLink = token ? "/dashboard" : "/login";    

  return (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh" }}>
      <Typography variant="h1" fontWeight={700} sx={{ mb: 2, fontSize: "2rem" }}>{t(locale, "common.title")}</Typography>
      <Typography variant="h6" sx={{ mb: 2 }}>{t(locale, "common.subtitle")}</Typography>
      <Link href={redirectLink} style={{ textDecoration: "none" }}>
        <Button variant="contained" color="primary">{t(locale, "common.start")}</Button>
      </Link>
    </Box>
  );
}