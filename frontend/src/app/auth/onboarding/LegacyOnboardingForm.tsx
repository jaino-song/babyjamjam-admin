"use client";

import { Alert, Box, Button, CircularProgress, MenuItem, Paper, TextField, Typography } from "@mui/material";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { completeLegacyOnboarding } from "./actions";

interface LegacyOnboardingFormProps {
  mode: "account" | "kakao";
  email?: string;
  name?: string;
  initialPhone?: string;
  initialBirthDate?: string;
  initialBranchId?: string;
  initialRole?: "admin" | "manager" | "user";
}

interface BranchOption {
  id: string;
  name: string;
}

const ROLE_OPTIONS = [
  { value: "admin", label: "관리자" },
  { value: "manager", label: "매니저" },
  { value: "user", label: "사용자" },
] as const;

export function LegacyOnboardingForm({
  mode,
  email,
  name,
  initialPhone = "",
  initialBirthDate = "",
  initialBranchId = "",
  initialRole,
}: LegacyOnboardingFormProps) {
  const router = useRouter();
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [phone, setPhone] = useState(initialPhone);
  const [birthDate, setBirthDate] = useState(initialBirthDate);
  const [branchId, setBranchId] = useState(initialBranchId);
  const [role, setRole] = useState<"admin" | "manager" | "user" | "">(initialRole || "");
  const [error, setError] = useState<string | null>(null);
  const [isLoadingBranches, setIsLoadingBranches] = useState(true);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    fetch("/api/auth/branches/all")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("지점 목록을 불러오지 못했습니다.");
        }
        return response.json() as Promise<BranchOption[]>;
      })
      .then(setBranches)
      .catch((requestError: unknown) => {
        setError(requestError instanceof Error ? requestError.message : "지점 목록을 불러오지 못했습니다.");
      })
      .finally(() => setIsLoadingBranches(false));
  }, []);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!/^01[016789]-?\d{3,4}-?\d{4}$/.test(phone)) {
      setError("유효한 전화번호를 입력해 주세요.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
      setError("생년월일을 YYYY-MM-DD 형식으로 입력해 주세요.");
      return;
    }
    if (!branchId || !role) {
      setError("지점과 역할을 선택해 주세요.");
      return;
    }

    startTransition(async () => {
      const result = await completeLegacyOnboarding(mode, {
        phone,
        birthDate,
        branchId,
        role,
      });
      if (!result.success) {
        setError(result.error || "계정 정보를 저장하지 못했습니다.");
        return;
      }
      router.replace("/messages/price-info");
      router.refresh();
    });
  };

  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 2, bgcolor: "grey.50" }}>
      <Paper component="main" elevation={2} sx={{ width: "100%", maxWidth: 480, p: { xs: 3, sm: 4 } }}>
        <Typography variant="h5" component="h1" fontWeight={700} gutterBottom>
          계정 정보 추가
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          API 기능을 사용하려면 비어 있는 계정 정보를 입력해 주세요.
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Box component="form" onSubmit={handleSubmit} sx={{ display: "grid", gap: 2 }}>
          <TextField label="이메일" value={email || ""} disabled fullWidth />
          <TextField label="이름" value={name || ""} disabled fullWidth />
          <TextField
            label="전화번호"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="010-1234-5678"
            fullWidth
            required
          />
          <TextField
            label="생년월일"
            value={birthDate}
            onChange={(event) => setBirthDate(event.target.value)}
            placeholder="1990-01-01"
            fullWidth
            required
          />
          <TextField
            select
            label="지점"
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
            disabled={isLoadingBranches}
            fullWidth
            required
          >
            {branches.map((branch) => (
              <MenuItem key={branch.id} value={branch.id}>{branch.name}</MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="역할"
            value={role}
            onChange={(event) => setRole(event.target.value as typeof role)}
            fullWidth
            required
          >
            {ROLE_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
            ))}
          </TextField>
          <Button type="submit" variant="contained" size="large" disabled={isPending || isLoadingBranches}>
            {isPending ? <CircularProgress size={22} color="inherit" /> : "저장하고 계속하기"}
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}
