"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { CardHeader } from "@/components/app/v3";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { getUserBranches, setCurrentBranch } from "./actions";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";

interface Branch {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    role: string;
}

export default function SelectBranchPage() {
    const router = useRouter();
    const locale = useLocale();
    const [branches, setBranches] = useState<Branch[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selecting, setSelecting] = useState<string | null>(null);

    useEffect(() => {
        const fetchBranches = async () => {
            try {
                const result = await getUserBranches();

                if (!result.success) {
                    setError(result.error || "지점 목록을 불러오는데 실패했습니다.");
                    return;
                }

                // If user has only one branch AND is not an owner, auto-select it
                // Owners should always see the selection screen to explicitly choose
                const isOwner = result.branches?.some(org => org.role === 'owner');
                if (result.branches?.length === 1 && !isOwner) {
                    const org = result.branches[0];
                    await handleSelectBranch(org.id);
                    return;
                }

                setBranches(result.branches || []);
            } catch (err) {
                console.error("[Select Branch] Error fetching branches:", err);
                setError("지점 목록을 불러오는데 실패했습니다.");
            } finally {
                setLoading(false);
            }
        };

        fetchBranches();
    }, [router]);

    const handleSelectBranch = async (branchId: string) => {
        setSelecting(branchId);

        try {
            const result = await setCurrentBranch(branchId);

            if (!result.success) {
                setError(result.error || "지점 선택에 실패했습니다.");
                setSelecting(null);
                return;
            }

            // Redirect to dashboard after successful selection
            router.replace("/dashboard");
        } catch (err) {
            console.error("[Select Branch] Error selecting branch:", err);
            setError("지점 선택에 실패했습니다.");
            setSelecting(null);
        }
    };

    if (loading) {
        return (
            <div data-component="select-branch" className="flex flex-col items-center justify-center min-h-[calc(100dvh-8rem)] gap-4">
                <Spinner size="lg" />
                <p className="text-foreground">지점 목록을 불러오는 중...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div data-component="select-branch" className="flex flex-col items-center justify-center min-h-[calc(100dvh-8rem)] gap-4 px-4">
                <div data-component="select-branch-error">
                    <p className="text-destructive">{error}</p>
                </div>
                <Button variant="outline" onClick={() => router.push("/login")}>
                    로그인 페이지로 돌아가기
                </Button>
            </div>
        );
    }

    if (branches.length === 0) {
        return (
            <div data-component="select-branch" className="flex flex-col items-center justify-center min-h-[calc(100dvh-8rem)] gap-6 px-4 text-center">
                <Building2 className="w-16 h-16 text-muted-foreground/50" />
                <div data-component="select-branch-empty">
                    <h2 className="text-xl font-bold text-foreground mb-2">
                        접근 가능한 지점이 없습니다
                    </h2>
                    <p className="text-muted-foreground">
                        관리자에게 지점 접근 권한을 요청해주세요.
                    </p>
                    <p className="text-sm text-muted-foreground mt-2">
                        권한이 부여되면 이 페이지를 새로고침하세요.
                    </p>
                </div>
                <div data-component="select-branch-empty-actions" className="flex gap-3">
                    <Button onClick={() => window.location.reload()}>
                        새로고침
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() => {
                            // Clear auth cookies and redirect to login
                            document.cookie = "auth_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
                            document.cookie = "refresh_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
                            document.cookie = "selected_branch_id=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
                            router.replace("/login");
                        }}
                    >
                        로그아웃
                    </Button>
                </div>
            </div>
        );
    }

    const getRoleBadgeVariant = (role: string) => {
        switch (role) {
            case "owner":
                return "secondary";
            case "admin":
                return "default";
            default:
                return "outline";
        }
    };

    const getRoleLabel = (role: string) => {
        return t(locale, `roles.${role}`) || t(locale, "roles.unknown");
    };

    return (
        <div data-component="select-branch" className="flex flex-col items-center justify-center min-h-[calc(100dvh-8rem)] gap-4 px-4">
            <CardHeader title="지점 선택" subtitle="지점을 선택해주세요" align="center" />

            <div data-component="select-branch-list" className="flex flex-col gap-3 w-full max-w-md">
                {branches.map((org) => (
                    <Card
                        key={org.id}
                        className={`cursor-pointer transition-all hover-lift ${selecting ? "opacity-60 cursor-not-allowed" : ""
                            }`}
                        onClick={() => !selecting && handleSelectBranch(org.id)}
                    >
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <Avatar className="bg-primary">
                                        <AvatarFallback className="bg-primary text-primary-foreground">
                                            <Building2 className="w-5 h-5" />
                                        </AvatarFallback>
                                    </Avatar>
                                    <div>
                                        <h3 className="text-base font-semibold text-foreground">
                                            {org.name}
                                        </h3>
                                        {org.description && (
                                            <p className="text-sm text-muted-foreground">
                                                {org.description}
                                            </p>
                                        )}
                                    </div>
                                </div>
                                {selecting === org.id ? (
                                    <Spinner size="sm" />
                                ) : (
                                    <Badge variant={getRoleBadgeVariant(org.role)}>
                                        {getRoleLabel(org.role)}
                                    </Badge>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>


        </div>
    );
}
