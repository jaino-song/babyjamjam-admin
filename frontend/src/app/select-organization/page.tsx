"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { AuthPanel } from "@/components/auth/auth-panel";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { FooterNavigation } from "@/components/ui/footer-navigation";
import { getRoleLabel } from "@/lib/constants/roles";
import { getUserOrganizations, setCurrentOrganization } from "./actions";

interface Organization {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    role: string;
}

const ORGANIZATIONS_PER_PAGE = 5;

export default function SelectOrganizationPage() {
    const router = useRouter();
    const [organizations, setOrganizations] = useState<Organization[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selecting, setSelecting] = useState<string | null>(null);
    const [currentPage, setCurrentPage] = useState(1);

    const handleSelectOrganization = useCallback(async (organizationId: string) => {
        setSelecting(organizationId);

        try {
            const result = await setCurrentOrganization(organizationId);

            if (!result.success) {
                setError(result.error || "조직 선택에 실패했습니다.");
                setSelecting(null);
                return;
            }

            router.replace("/dashboard");
        } catch (err) {
            console.error("[Select Organization] Error selecting organization:", err);
            setError("조직 선택에 실패했습니다.");
            setSelecting(null);
        }
    }, [router]);

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
                setCurrentPage(1);
            } catch (err) {
                console.error("[Select Organization] Error fetching organizations:", err);
                setError("조직 목록을 불러오는데 실패했습니다.");
            } finally {
                setLoading(false);
            }
        };

        fetchOrganizations();
    }, [handleSelectOrganization]);

    if (loading) {
        return (
            <AuthPanel
                dataComponents={{
                    container: "select-org",
                    card: "select-org-container",
                    header: "select-org-header",
                    title: "select-org-title",
                    subtitle: "select-org-subtitle",
                    content: "select-org-content",
                }}
                containerClassName="!h-full min-h-0 items-center overflow-hidden py-0 md:py-0"
                className="min-h-[70vh] gap-5 !p-5 sm:!p-6 [&_[data-component='select-org-title']]:!text-[1.72rem] md:[&_[data-component='select-org-title']]:!text-[1.5rem] [&_[data-component='select-org-subtitle']]:!max-w-[30ch] [&_[data-component='select-org-subtitle']]:!text-[0.82rem] md:[&_[data-component='select-org-subtitle']]:!text-[0.76rem]"
                contentClassName="flex-1 gap-5"
                title="조직 불러오는 중"
                subtitle="계정에 연결된 조직을 정리하고 있습니다."
            >
                <div data-component="select-org-loading" className="flex flex-col items-center gap-4 py-6 text-center">
                    <Spinner size="lg" className="text-v3-primary" />
                    <p className="text-sm text-v3-text-muted">조직 목록을 불러오는 중...</p>
                </div>
            </AuthPanel>
        );
    }

    if (error) {
        return (
            <AuthPanel
                dataComponents={{
                    container: "select-org",
                    card: "select-org-container",
                    header: "select-org-header",
                    title: "select-org-title",
                    subtitle: "select-org-subtitle",
                    content: "select-org-content",
                }}
                containerClassName="!h-full min-h-0 items-center overflow-hidden py-0 md:py-0"
                className="min-h-[70vh] gap-5 !p-5 sm:!p-6 [&_[data-component='select-org-title']]:!text-[1.72rem] md:[&_[data-component='select-org-title']]:!text-[1.5rem] [&_[data-component='select-org-subtitle']]:!max-w-[30ch] [&_[data-component='select-org-subtitle']]:!text-[0.82rem] md:[&_[data-component='select-org-subtitle']]:!text-[0.76rem]"
                contentClassName="flex-1 gap-5"
                title="조직을 불러오지 못했습니다"
                subtitle="권한 확인 또는 다시 로그인이 필요할 수 있습니다."
            >
                <div data-component="select-org-error" className="flex flex-col items-center gap-4 text-center">
                    <p className="rounded-full bg-destructive/10 px-3 py-1 text-sm font-semibold text-destructive">
                        {error}
                    </p>
                    <Button variant="outline" onClick={() => router.push("/login")}>
                        로그인 페이지로 돌아가기
                    </Button>
                </div>
            </AuthPanel>
        );
    }

    if (organizations.length === 0) {
        return (
            <AuthPanel
                dataComponents={{
                    container: "select-org",
                    card: "select-org-container",
                    header: "select-org-header",
                    title: "select-org-title",
                    subtitle: "select-org-subtitle",
                    content: "select-org-content",
                }}
                containerClassName="!h-full min-h-0 items-center overflow-hidden py-0 md:py-0"
                className="min-h-[70vh] gap-5 !p-5 sm:!p-6 [&_[data-component='select-org-title']]:!text-[1.72rem] md:[&_[data-component='select-org-title']]:!text-[1.5rem] [&_[data-component='select-org-subtitle']]:!max-w-[30ch] [&_[data-component='select-org-subtitle']]:!text-[0.82rem] md:[&_[data-component='select-org-subtitle']]:!text-[0.76rem]"
                contentClassName="flex-1 gap-5"
                title="접근 가능한 조직이 없습니다"
                subtitle="관리자에게 조직 접근 권한을 요청한 뒤 다시 시도해 주세요."
            >
                <div data-component="select-org-empty-state" className="flex flex-col items-center gap-6 text-center">
                    <div data-component="select-org-empty-icon" className="flex h-16 w-16 items-center justify-center rounded-full bg-v3-primary/8 text-v3-primary">
                        <Building2 className="h-8 w-8" />
                    </div>
                    <div data-component="select-org-empty">
                        <p className="text-sm text-v3-text-muted">
                            권한이 부여되면 이 페이지를 새로고침하세요.
                        </p>
                    </div>
                    <div data-component="select-org-empty-actions" className="flex gap-3">
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
            </AuthPanel>
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

    const totalPages = Math.max(1, Math.ceil(organizations.length / ORGANIZATIONS_PER_PAGE));
    const pageStartIndex = (currentPage - 1) * ORGANIZATIONS_PER_PAGE;
    const paginatedOrganizations = organizations.slice(
        pageStartIndex,
        pageStartIndex + ORGANIZATIONS_PER_PAGE,
    );



    return (
        <AuthPanel
            dataComponents={{
                container: "select-org",
                card: "select-org-container",
                header: "select-org-header",
                title: "select-org-title",
                subtitle: "select-org-subtitle",
                content: "select-org-content",
            }}
            containerClassName="!h-full min-h-0 items-center overflow-hidden py-0 md:py-0"
            className="min-h-[70vh] gap-5 !p-5 sm:!p-6 [&_[data-component='select-org-title']]:!text-[1.72rem] md:[&_[data-component='select-org-title']]:!text-[1.5rem] [&_[data-component='select-org-subtitle']]:!max-w-[30ch] [&_[data-component='select-org-subtitle']]:!text-[0.82rem] md:[&_[data-component='select-org-subtitle']]:!text-[0.76rem]"
            contentClassName="flex-1 gap-5"
            title="지점 선택"
            subtitle="지점을 선택해 주세요."
        >
            <div data-component="select-org-list" className="flex w-full flex-1 flex-col gap-3">
                {paginatedOrganizations.map((org) => (
                    <Card
                        key={org.id}
                        className={`cursor-pointer rounded-[24px] border-[1.35px] border-v3-border bg-white shadow-[0_4px_24px_hsla(214,50%,20%,0.06)] transition-all duration-300 ease-in-out hover:-translate-y-1 hover:border-v3-primary/35 hover:shadow-[0_12px_48px_hsla(214,50%,20%,0.12)] ${
                            selecting ? "opacity-60 cursor-not-allowed" : ""
                        }`}
                        onClick={() => !selecting && handleSelectOrganization(org.id)}
                    >
                        <CardContent className="p-4">
                            <div data-component="select-org-card-row" className="flex items-center justify-between gap-4">
                                <div data-component="select-org-card-main" className="flex items-center gap-3">
                                    <Avatar className="h-11 w-11 rounded-[18px] bg-[linear-gradient(180deg,hsl(214,100%,34%),hsl(214,92%,28%))] ring-1 ring-v3-primary/15">
                                        <AvatarFallback className="rounded-[18px] bg-transparent text-primary-foreground">
                                            <Building2 className="w-5 h-5" />
                                        </AvatarFallback>
                                    </Avatar>
                                    <div data-component="select-org-card-text" className="flex min-w-0 flex-col gap-1">
                                        <h3 className="text-base font-semibold tracking-[-0.02em] text-v3-dark">
                                            {org.name}
                                        </h3>
                                        {org.description && (
                                            <p className="text-sm leading-5 text-v3-text-muted">
                                                {org.description}
                                            </p>
                                        )}
                                    </div>
                                </div>
                                {selecting === org.id ? (
                                    <div data-component="select-org-card-spinner" className="flex h-8 w-8 items-center justify-center rounded-full bg-v3-primary/10">
                                        <Spinner size="sm" className="text-v3-primary" />
                                    </div>
                                ) : (
                                    <Badge
                                        variant={getRoleBadgeVariant(org.role)}
                                        className="px-2.5 py-1 text-[0.72rem] font-semibold"
                                    >
                                        {getRoleLabel(org.role)}
                                    </Badge>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
            <FooterNavigation
                dataComponent="select-org-pagination"
                prevDataComponent="select-org-pagination-prev"
                nextDataComponent="select-org-pagination-next"
                positionDataComponent="select-org-pagination-position"
                positionLabel={`${currentPage} / ${totalPages}`}
                prevVariant="outline"
                nextVariant="outline"
                prevDisabled={currentPage === 1 || Boolean(selecting)}
                nextDisabled={currentPage === totalPages || Boolean(selecting)}
                onPrev={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                onNext={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                prevClassName="w-1/4 min-w-[96px] justify-self-start"
                nextClassName="w-1/4 min-w-[96px] justify-self-end"
            />
        </AuthPanel>
    );
}
