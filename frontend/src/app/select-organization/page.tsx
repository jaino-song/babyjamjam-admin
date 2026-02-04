"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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

                // If user has only one organization AND is not an owner, auto-select it
                // Owners should always see the selection screen to explicitly choose
                const isOwner = result.organizations?.some(org => org.role === 'owner');
                if (result.organizations?.length === 1 && !isOwner) {
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
            <div className="flex flex-col items-center justify-center h-screen gap-4">
                <Spinner size="lg" />
                <p className="text-foreground">조직 목록을 불러오는 중...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center h-screen gap-4 px-4">
                <p className="text-destructive">{error}</p>
                <Button variant="outline" onClick={() => router.push("/login")}>
                    로그인 페이지로 돌아가기
                </Button>
            </div>
        );
    }

    if (organizations.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-screen gap-6 px-4 text-center">
                <Building2 className="w-16 h-16 text-muted-foreground/50" />
                <div>
                    <h2 className="text-xl font-bold text-foreground mb-2">
                        접근 가능한 조직이 없습니다
                    </h2>
                    <p className="text-muted-foreground">
                        관리자에게 조직 접근 권한을 요청해주세요.
                    </p>
                    <p className="text-sm text-muted-foreground mt-2">
                        권한이 부여되면 이 페이지를 새로고침하세요.
                    </p>
                </div>
                <div className="flex gap-3">
                    <Button onClick={() => window.location.reload()}>
                        새로고침
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() => {
                            // Clear auth cookies and redirect to login
                            document.cookie = "auth_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
                            document.cookie = "refresh_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
                            document.cookie = "selected_organization_id=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
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
        switch (role) {
            case "owner":
                return "소유자";
            case "admin":
                return "관리자";
            default:
                return "사용자";
        }
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-6 px-4 py-8">
            <h1 className="text-2xl font-bold text-foreground">
                조직 선택
            </h1>
            <p className="text-muted-foreground">
                작업할 조직을 선택해주세요
            </p>

            <div className="flex flex-col gap-3 w-full max-w-md">
                {organizations.map((org) => (
                    <Card
                        key={org.id}
                        className={`cursor-pointer transition-all hover-lift ${
                            selecting ? "opacity-60 cursor-not-allowed" : ""
                        }`}
                        onClick={() => !selecting && handleSelectOrganization(org.id)}
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
                                <Badge variant={getRoleBadgeVariant(org.role)}>
                                    {getRoleLabel(org.role)}
                                </Badge>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {selecting && (
                <div className="flex items-center gap-2 mt-4">
                    <Spinner size="sm" />
                    <p className="text-sm text-muted-foreground">
                        조직 설정 중...
                    </p>
                </div>
            )}
        </div>
    );
}
