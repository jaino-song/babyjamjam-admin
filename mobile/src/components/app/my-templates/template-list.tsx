"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ErrorFallback } from "@/components/app/ui/error-fallback";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { useMessageTemplates } from "@/hooks/use-message-templates";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { MessageTemplate } from "@/lib/template/types";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";
import { normalizeApiError } from "@babyjamjam/shared";

// Date formatting helper
const formatDate = (dateString: string): string => {
    return formatDateForDisplay(dateString);
};

export const TemplateList = () => {
    const router = useRouter();
    const locale = useLocale();
    const {
        data: templates,
        isLoading,
        isError,
        error,
        refetch,
        isFetching,
    } = useMessageTemplates();
    const hasData = templates !== undefined;
    const normalizedError = error
        ? normalizeApiError(error, { operation: "read", locale: "ko-KR" })
        : null;
    const showError = isError && Boolean(normalizedError) && !normalizedError?.suppress;

    const handleRowClick = (id: string) => {
        router.push(`/messages/templates/${id}/edit`);
    };

    const handleCreate = () => {
        router.push("/messages/templates/new");
    };

    const rowsPerPage = 5;

    return (
        <div data-component="mobile_my-templates_list">
            {/* Toolbar */}
            <div
                data-component="mobile_my-templates_list_toolbar"
                className="flex items-center justify-end"
            >
                {/* New Template Button */}
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleCreate}
                    className="text-primary"
                >
                    <Plus className="h-7 w-7" strokeWidth={2} />
                </Button>
            </div>

            <Separator />

            {/* Table */}
            <div className="min-h-[200px] w-full">
                {showError && !hasData ? (
                    <ErrorFallback
                        title="템플릿을 불러오지 못했어요"
                        description={normalizedError?.message ?? "요청한 정보를 불러오지 못했어요."}
                        onReset={() => void refetch()}
                    />
                ) : isLoading && !hasData ? (
                    <div data-component="mobile_my-templates_list_loading">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="text-center w-[60%] font-medium text-muted-foreground text-sm whitespace-nowrap">
                                        템플릿 이름
                                    </TableHead>
                                    <TableHead className="text-center w-[40%] font-medium text-muted-foreground text-sm whitespace-nowrap">
                                        최근 수정일
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {Array.from({ length: rowsPerPage }).map((_, index) => (
                                    <TableRow key={`skeleton-${index}`}>
                                        <TableCell className="text-center px-1">
                                            <Skeleton className="h-4 w-[60%] mx-auto" />
                                        </TableCell>
                                        <TableCell className="text-center px-1">
                                            <Skeleton className="h-4 w-[70%] mx-auto" />
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                ) : (
                    <>
                        {showError ? (
                            <div className="py-4">
                                <Alert
                                    variant="warning"
                                    role="status"
                                    aria-live="polite"
                                    data-component="mobile_my-templates_list_refresh-error"
                                >
                                    <AlertTitle>템플릿을 새로 불러오지 못했어요</AlertTitle>
                                    <AlertDescription>
                                        <p>{normalizedError?.message}</p>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="mt-3"
                                            onClick={() => void refetch()}
                                            disabled={isFetching}
                                        >
                                            다시 시도
                                        </Button>
                                    </AlertDescription>
                                </Alert>
                            </div>
                        ) : null}
                        {templates && templates.length > 0 ? (
                            <div data-component="mobile_my-templates_list_table">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="text-center w-[60%] font-medium text-muted-foreground text-sm whitespace-nowrap">
                                                템플릿 이름
                                            </TableHead>
                                            <TableHead className="text-center w-[40%] font-medium text-muted-foreground text-sm whitespace-nowrap">
                                                최근 수정일
                                            </TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {templates.map((template: MessageTemplate, index: number) => (
                                            <TableRow
                                                key={template.id}
                                                onClick={() => handleRowClick(template.id)}
                                                className="cursor-pointer transition-all duration-200 hover:bg-muted/50 opacity-0 animate-fade-in"
                                                style={{ animationDelay: `${150 + index * 30}ms` }}
                                            >
                                                <TableCell className="font-medium whitespace-nowrap">
                                                    {template.name}
                                                </TableCell>
                                                <TableCell className="text-muted-foreground whitespace-nowrap">
                                                    {formatDate(template.updatedAt)}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        ) : !normalizedError?.suppress ? (
                            <div className="py-4">
                                <Alert>
                                    <AlertDescription>{t(locale, "common.no-data")}</AlertDescription>
                                </Alert>
                            </div>
                        ) : null}
                    </>
                )}
            </div>
        </div>
    );
};
