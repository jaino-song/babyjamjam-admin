"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  Stack,
  Avatar,
  Chip,
} from "@mui/material";
import { Business as BusinessIcon } from "@mui/icons-material";
import { MoonLoader } from "react-spinners";
import { getUserOrganizations, setCurrentOrganization } from "./actions";

interface Organization {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  role: string;
}

export default function SelectOrganizationPage() {
  const router = useRouter();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState<string | null>(null);

  useEffect(() => {
    const fetchOrganizations = async () => {
      try {
        const result = await getUserOrganizations();
        
        if (!result.success) {
          setError(result.error || "조직 목록을 불러오는데 실패했습니다.");
          return;
        }

        // If user has only one organization, auto-select it
        if (result.organizations?.length === 1) {
          const org = result.organizations[0];
          await handleSelectOrganization(org.id);
          return;
        }

        setOrganizations(result.organizations || []);
      } catch (err) {
        console.error("[Select Organization] Error fetching organizations:", err);
        setError("조직 목록을 불러오는데 실패했습니다.");
      } finally {
        setLoading(false);
      }
    };

    fetchOrganizations();
  }, [router]);

  const handleSelectOrganization = async (organizationId: string) => {
    setSelecting(organizationId);
    
    try {
      const result = await setCurrentOrganization(organizationId);
      
      if (!result.success) {
        setError(result.error || "조직 선택에 실패했습니다.");
        setSelecting(null);
        return;
      }

      // Redirect to dashboard after successful selection
      router.replace("/dashboard");
    } catch (err) {
      console.error("[Select Organization] Error selecting organization:", err);
      setError("조직 선택에 실패했습니다.");
      setSelecting(null);
    }
  };

  if (loading) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          gap: 2,
        }}
      >
        <MoonLoader />
        <Typography>조직 목록을 불러오는 중...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          gap: 2,
          px: 2,
        }}
      >
        <Typography color="error">{error}</Typography>
        <Button variant="outlined" onClick={() => router.push("/login")}>
          로그인 페이지로 돌아가기
        </Button>
      </Box>
    );
  }

  if (organizations.length === 0) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          gap: 2,
          px: 2,
        }}
      >
        <Typography>접근 가능한 조직이 없습니다.</Typography>
        <Button variant="outlined" onClick={() => router.push("/login")}>
          로그인 페이지로 돌아가기
        </Button>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        gap: 3,
        px: 2,
        py: 4,
      }}
    >
      <Typography variant="h4" component="h1" fontWeight="bold">
        조직 선택
      </Typography>
      <Typography variant="body1" color="text.secondary">
        작업할 조직을 선택해주세요
      </Typography>

      <Stack spacing={2} sx={{ width: "100%", maxWidth: 400 }}>
        {organizations.map((org) => (
          <Card
            key={org.id}
            sx={{
              cursor: selecting ? "not-allowed" : "pointer",
              opacity: selecting ? 0.6 : 1,
              transition: "all 0.2s",
              "&:hover": {
                transform: selecting ? "none" : "translateY(-2px)",
                boxShadow: selecting ? 1 : 3,
              },
            }}
            onClick={() =>
              !selecting && handleSelectOrganization(org.id)
            }
          >
            <CardContent>
              <Stack
                direction="row"
                spacing={2}
                alignItems="center"
                justifyContent="space-between"
              >
                <Stack direction="row" spacing={2} alignItems="center">
                  <Avatar sx={{ bgcolor: "primary.main" }}>
                    <BusinessIcon />
                  </Avatar>
                  <Box>
                    <Typography variant="h6" component="div">
                      {org.name}
                    </Typography>
                    {org.description && (
                      <Typography variant="body2" color="text.secondary">
                        {org.description}
                      </Typography>
                    )}
                  </Box>
                </Stack>
                <Chip
                  label={org.role === "admin" ? "관리자" : "사용자"}
                  color={org.role === "admin" ? "primary" : "default"}
                  size="small"
                />
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>

      {selecting && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 2 }}>
          <MoonLoader size={20} />
          <Typography variant="body2" color="text.secondary">
            조직 설정 중...
          </Typography>
        </Box>
      )}
    </Box>
  );
}
