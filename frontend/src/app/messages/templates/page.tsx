"use client";

import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Skeleton,
  IconButton,
  Divider,
} from "@mui/material";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { ContentPaper } from "@/app/(components)/root/content-paper";
import { useSystemTemplates } from "@/features/system-templates/hooks";
import { useMessageTemplates } from "@/app/hooks/use-message-templates";

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
    <Box sx={{ bgcolor: "background.paper" }}>
      <Box
        component="section"
        sx={{
          px: { xs: 2, sm: 3, md: 6 },
          py: { xs: 3, sm: 4 },
          mx: "auto",
        }}
      >
        <ContentPaper
          title="템플릿 관리"
          subtitle="시스템 및 사용자 정의 메시지 템플릿을 관리합니다"
          sx={{ minHeight: "70vh" }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
            }}
          >
            <IconButton
              size="medium"
              sx={{ color: "#1e88e5" }}
              onClick={handleCreate}
              aria-label="create template"
            >
              <Plus size={30} strokeWidth={2} />
            </IconButton>
          </Box>

          <Divider />

          <Box sx={{ minHeight: 200, width: "100%" }}>
            <TableContainer data-component="templates-page-table-container">
              <Table sx={{ tableLayout: "fixed", width: "100%" }}>
                <TableHead>
                  <TableRow>
                    <TableCell
                      align="center"
                      sx={{
                        fontWeight: 500,
                        color: "rgba(0, 0, 0, 0.6)",
                        fontSize: "0.875rem",
                        width: "60%",
                        whiteSpace: "nowrap",
                      }}
                    >
                      템플릿 이름
                    </TableCell>
                    <TableCell
                      align="center"
                      sx={{
                        fontWeight: 500,
                        color: "rgba(0, 0, 0, 0.6)",
                        fontSize: "0.875rem",
                        width: "40%",
                        whiteSpace: "nowrap",
                      }}
                    >
                      최근 수정일
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell align="center" sx={{ px: 1 }}>
                          <Skeleton variant="text" width="60%" sx={{ mx: "auto" }} />
                        </TableCell>
                        <TableCell align="center" sx={{ px: 1 }}>
                          <Skeleton variant="text" width="70%" sx={{ mx: "auto" }} />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    allTemplates.map((template) => (
                      <TableRow
                        key={`${template.type}-${template.displayId}`}
                        hover
                        onClick={() => handleRowClick(template)}
                        sx={{
                          cursor: "pointer",
                          "&:hover": { bgcolor: "rgba(0, 0, 0, 0.04)" },
                        }}
                        data-type={template.type}
                      >
                        <TableCell
                          align="center"
                          sx={{
                            fontSize: "0.875rem",
                            color: "rgba(0, 0, 0, 0.87)",
                            whiteSpace: "nowrap",
                            px: 1,
                          }}
                        >
                          {template.name}
                        </TableCell>
                        <TableCell
                          align="center"
                          sx={{
                            fontSize: "0.875rem",
                            color: "rgba(0, 0, 0, 0.87)",
                            whiteSpace: "nowrap",
                            px: 1,
                          }}
                        >
                          {formatDate(template.updatedAt)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        </ContentPaper>
      </Box>
    </Box>
  );
}
