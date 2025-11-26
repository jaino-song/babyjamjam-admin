import Link from "next/link";
import { Box, Button, Typography } from "@mui/material";


export default async function Home() {
  const API_BASE_URL =
  process.env.RAILWAY_PUBLIC_API_BASE_URL ||
    process.env.PRODUCTION_API_BASE_URL ||
    process.env.DEVELOPMENT_API_BASE_URL;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh" }}>
      <Typography variant="h3" fontWeight={700} sx={{ mb: 2 }}>인천 아이미래로 백오피스</Typography>
      <Link href={`${API_BASE_URL}/auth/kakao`} style={{ textDecoration: "none" }}>
        <Button variant="contained" color="primary">시작하기</Button>
      </Link>
    </Box>
  );
}
