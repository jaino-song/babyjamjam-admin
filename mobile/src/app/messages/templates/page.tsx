"use client";

import { ArrowLeft, Info, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ContentPaper } from "@/components/app/root/content-paper";
import { useSystemTemplates } from "@/features/system-templates/hooks";
import { useMessageTemplates } from "@/hooks/use-message-templates";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

const formatDate = (dateString: string): string => {
  return new Date(dateString).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
};

export default function TemplatesPage() {
  const router = useRouter();

  const { data: systemTemplates, isLoading: isLoadingSystem } = useSystemTemplates();
  const { data: userTemplates, isLoading: isLoadingUser } = useMessageTemplates();

  const isLoading = isLoadingSystem || isLoadingUser;

  const allTemplates = [
    ...(systemTemplates || []).map((t) => ({
      ...t,
      type: "system" as const,
      displayId: t.templateKey,
    })),
    ...(userTemplates || []).map((t) => ({
      ...t,
      type: "user" as const,
      displayId: t.id,
    })),
  ].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const handleRowClick = (template: typeof allTemplates[0]) => {
    if (template.type === "system") {
      router.push(`/messages/system-templates/${template.displayId}`);
    } else {
      router.push(`/messages/new?template=${encodeURIComponent(String(template.displayId))}`);
    }
  };

  return (
    <div data-component="messages-templates" className="bg-background">
      <section data-component="messages-templates-content" className="px-2 sm:px-3 md:px-6 py-3 sm:py-4 mx-auto">
        <div data-component="messages-templates-nav" className="mb-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/messages" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              뒤로
            </Link>
          </Button>
        </div>
        <ContentPaper
          title="템플릿 목록"
          subtitle="템플릿을 선택하면 메시지 발송 화면으로 이동합니다"
          className="min-h-[70vh]"
        >
          <div
            data-component="messages-templates-desktop-notice"
            className="mb-3 flex items-start gap-2 rounded-2xl border border-v3-border/60 bg-v3-dim-white px-3 py-2 text-[0.75rem] text-v3-text-muted"
          >
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-v3-primary" />
            <p>
              템플릿 생성·편집은 <span className="font-semibold text-v3-dark">데스크톱</span>에서만 가능합니다.
              모바일에서는 선택해서 발송할 수 있습니다.
            </p>
          </div>

          <Separator />

          <div className="min-h-[200px] w-full" data-component="messages-templates-table">
            <Table className="table-fixed w-full">
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">
                    템플릿 이름
                  </TableHead>
                  <TableHead className="whitespace-nowrap">
                    최근 수정일
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }, (_, i) => `loading-row-${i}`).map((loadingRowKey) => (
                    <TableRow key={loadingRowKey}>
                      <TableCell>
                        <Skeleton className="h-4 w-[60%] mx-auto" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-[70%] mx-auto" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  allTemplates.map((template, index) => (
                    <TableRow
                      key={`${template.type}-${template.displayId}`}
                      onClick={() => handleRowClick(template)}
                      className="cursor-pointer transition-all duration-200 hover:bg-muted/50 opacity-0 animate-fade-in"
                      style={{ animationDelay: `${150 + index * 30}ms` }}
                      data-type={template.type}
                    >
                      <TableCell className="font-medium whitespace-nowrap">
                        {template.name}
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {formatDate(template.updatedAt)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </ContentPaper>
      </section>
    </div>
  );
}
