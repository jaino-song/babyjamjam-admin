"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { ContentPaper } from "@/app/(components)/root/content-paper";
import { useSystemTemplates } from "@/features/system-templates/hooks";
import { useMessageTemplates } from "@/app/hooks/use-message-templates";
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
      router.push(`/messages/templates/${template.displayId}/edit`);
    }
  };

  const handleCreate = () => {
    router.push("/messages/templates/new");
  };

  return (
    <div className="bg-background">
      <section className="px-2 sm:px-3 md:px-6 py-3 sm:py-4 mx-auto">
        <ContentPaper
          title="템플릿 관리"
          subtitle="시스템 및 사용자 정의 메시지 템플릿을 관리합니다"
          className="min-h-[70vh]"
        >
          <div className="flex items-center justify-end py-2">
            <Button
              className="gap-2 w-[100px]"
              onClick={handleCreate}
            >
              <Plus className="h-4 w-4" />
              추가
            </Button>
          </div>

          <Separator />

          <div className="min-h-[200px] w-full" data-component="templates-page-table-container">
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
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
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
