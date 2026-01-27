"use client";

import {
    Box,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    IconButton,
    CircularProgress,
    Alert,
    Divider,
    Skeleton,
} from "@mui/material";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMessageTemplates } from "@/app/hooks/use-message-templates";
import { useLocale } from "@/app/(components)/LocaleProvider";
import { t } from "@/app/lib/i18n/translations";
import { MessageTemplate } from "@/lib/template/types";

// Date formatting helper
const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
};

export const TemplateList = () => {
    const router = useRouter();
    const locale = useLocale();
    const { data: templates, isLoading } = useMessageTemplates();

    const handleRowClick = (id: string) => {
        router.push(`/messages/templates/${id}/edit`);
    };

    const handleCreate = () => {
        router.push("/messages/templates/new");
    };

    const rowsPerPage = 5;

    return (
        <Box data-component="template-list-container">
            {/* Toolbar */}
            <Box
                data-component="template-list-toolbar"
                sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                }}
            >
                {/* New Template Button */}
                <IconButton
                    size="medium"
                    sx={{ color: "#1e88e5" }}
                    onClick={handleCreate}
                >
                    <Plus size={30} strokeWidth={2} />
                </IconButton>
            </Box>

            <Divider />

            {/* Table */}
            <Box sx={{ minHeight: 200, width: "100%" }}>
                {isLoading ? (
                    <TableContainer data-component="template-list-loading-container">
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
                                {Array.from({ length: rowsPerPage }).map((_, index) => (
                                    <TableRow key={`skeleton-${index}`}>
                                        <TableCell align="center" sx={{ px: 1 }}>
                                            <Skeleton variant="text" width="60%" sx={{ mx: "auto" }} />
                                        </TableCell>
                                        <TableCell align="center" sx={{ px: 1 }}>
                                            <Skeleton variant="text" width="70%" sx={{ mx: "auto" }} />
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                ) : templates && templates.length > 0 ? (
                    <TableContainer data-component="template-list-table-container">
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
                                {templates.map((template: MessageTemplate) => (
                                    <TableRow
                                        key={template.id}
                                        hover
                                        onClick={() => handleRowClick(template.id)}
                                        sx={{
                                            cursor: "pointer",
                                            "&:hover": { bgcolor: "rgba(0, 0, 0, 0.04)" }
                                        }}
                                    >
                                        <TableCell
                                            align="center"
                                            sx={{
                                                fontSize: "0.875rem",
                                                color: "rgba(0, 0, 0, 0.87)",
                                                whiteSpace: "nowrap",
                                                px: 1
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
                                                px: 1
                                            }}
                                        >
                                            {formatDate(template.updatedAt)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                ) : (
                    <Box sx={{ py: 3 }}>
                        <Alert severity="info">{t(locale, "common.no-data")}</Alert>
                    </Box>
                )}
            </Box>
        </Box>
    );
};
