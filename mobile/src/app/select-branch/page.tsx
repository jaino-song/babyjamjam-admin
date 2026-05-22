"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check } from "lucide-react";

import { useInitialUser } from "@/providers/UserProvider";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { getUserBranches, setCurrentBranch } from "./actions";
import "@/components/app/mobile-redesign/redesign.css";

interface Branch {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  role: string;
}

const BRANCH_ICON_COLORS = [
  "hsl(var(--v3-primary))",
  "hsl(267, 50%, 46%)",
  "hsl(var(--v3-orange))",
  "hsl(var(--v3-green))",
  "hsl(var(--v3-burgundy))",
];

export default function SelectBranchPage() {
  const router = useRouter();
  const locale = useLocale();
  const user = useInitialUser();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const fetchBranches = async () => {
      try {
        const result = await getUserBranches();

        if (!result.success) {
          setError(result.error || "지점 목록을 불러오는데 실패했습니다.");
          return;
        }

        const isOwner = result.branches?.some((org) => org.role === "owner");
        if (result.branches?.length === 1 && !isOwner) {
          const org = result.branches[0];
          await confirmSelectBranch(org.id);
          return;
        }

        const fetched = result.branches || [];
        setBranches(fetched);
        if (fetched.length > 0 && !selectedId) setSelectedId(fetched[0].id);
      } catch (err) {
        console.error("[Select Branch] Error fetching branches:", err);
        setError("지점 목록을 불러오는데 실패했습니다.");
      } finally {
        setLoading(false);
      }
    };

    fetchBranches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const confirmSelectBranch = async (branchId: string) => {
    setSubmitting(true);
    try {
      const result = await setCurrentBranch(branchId);
      if (!result.success) {
        setError(result.error || "지점 선택에 실패했습니다.");
        setSubmitting(false);
        return;
      }
      router.replace("/dashboard");
    } catch (err) {
      console.error("[Select Branch] Error selecting branch:", err);
      setError("지점 선택에 실패했습니다.");
      setSubmitting(false);
    }
  };

  const handleLogout = () => {
    document.cookie = "auth_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    document.cookie = "refresh_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    document.cookie = "selected_branch_id=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    router.replace("/login");
  };

  const getRoleLabel = (role: string) => t(locale, `roles.${role}`) || t(locale, "roles.unknown");

  if (loading) {
    return (
      <div
        className="branch-page"
        data-component="select-branch"
        style={{ alignItems: "center", justifyContent: "center" }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
            color: "hsl(var(--v3-text-muted))",
            fontSize: "0.86rem",
          }}
        >
          <Building2 size={48} strokeWidth={1.5} />
          지점 목록을 불러오는 중...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="branch-page" data-component="select-branch">
        <div className="branch-header">
          <div className="branch-title">지점 선택</div>
        </div>
        <div className="auth-server-error" role="alert" data-component="select-branch-error">
          {error}
        </div>
        <button
          type="button"
          className="branch-btn"
          style={{ marginTop: "auto" }}
          onClick={() => router.push("/login")}
        >
          로그인 페이지로 돌아가기
        </button>
      </div>
    );
  }

  if (branches.length === 0) {
    return (
      <div className="branch-page" data-component="select-branch">
        <div className="branch-header">
          <div className="branch-title">접근 가능한 지점이 없습니다</div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
            padding: "32px 16px",
            textAlign: "center",
            color: "hsl(var(--v3-text-muted))",
          }}
        >
          <Building2 size={48} strokeWidth={1.5} />
          <p style={{ fontSize: "0.86rem", lineHeight: 1.55, color: "hsl(var(--v3-dark))" }}>
            관리자에게 지점 접근 권한을 요청해주세요.
          </p>
          <p style={{ fontSize: "0.74rem" }}>권한이 부여되면 이 페이지를 새로고침하세요.</p>
        </div>
        <div className="branch-actions">
          <button type="button" className="branch-btn" onClick={() => window.location.reload()}>
            새로고침
          </button>
          <button type="button" className="logout-link" onClick={handleLogout}>
            <span>로그아웃</span>
          </button>
        </div>
      </div>
    );
  }

  const selectedBranch = branches.find((b) => b.id === selectedId);

  return (
    <div className="branch-page" data-component="select-branch">
      <div className="branch-header">
        <div className="branch-title">지점 선택</div>
      </div>

      {user && (
        <div className="branch-user" data-component="select-branch-user">
          <div className="branch-user-avatar">{user.name?.charAt(0) || "?"}</div>
          <div className="branch-user-info">
            <div className="branch-user-name">{user.name || "사용자"}</div>
            {user.email && <div className="branch-user-email">{user.email}</div>}
          </div>
        </div>
      )}

      <div className="branch-list" data-component="select-branch-list">
        {branches.map((branch, idx) => {
          const iconColor = BRANCH_ICON_COLORS[idx % BRANCH_ICON_COLORS.length];
          const isSelected = branch.id === selectedId;
          return (
            <button
              key={branch.id}
              type="button"
              className={`branch-card ${isSelected ? "selected" : ""}`}
              onClick={() => setSelectedId(branch.id)}
              disabled={submitting}
              data-component="select-branch-row"
            >
              <div className="branch-card-icon" style={{ background: iconColor }}>
                <Building2 size={20} strokeWidth={2.5} />
              </div>
              <div className="branch-card-info">
                <div className="branch-card-name">
                  {branch.name}
                  <span className="role-pill">{getRoleLabel(branch.role)}</span>
                </div>
              </div>
              {isSelected && (
                <Check className="branch-card-check" size={24} strokeWidth={3} />
              )}
            </button>
          );
        })}
      </div>

      <div className="branch-actions">
        <button
          type="button"
          className="branch-btn"
          onClick={() => selectedId && confirmSelectBranch(selectedId)}
          disabled={!selectedId || submitting}
        >
          {submitting
            ? "이동 중…"
            : selectedBranch
              ? `${selectedBranch.name}으로 이동`
              : "지점을 선택하세요"}
        </button>
        <button type="button" className="logout-link" onClick={handleLogout}>
          <span>로그아웃</span>
        </button>
      </div>
    </div>
  );
}
