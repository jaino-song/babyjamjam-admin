import Link from "next/link";
import { Box, Button, Typography } from "@mui/material";


export default async function Home() {

  return (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh" }}>
      <Typography variant="h3" fontWeight={700} sx={{ mb: 2 }}>인천 아이미래로 백오피스</Typography>
      <Link href="/login" style={{ textDecoration: "none" }}>
        <Button variant="contained" color="primary">시작하기</Button>
      </Link>
    </Box>
  );
}
