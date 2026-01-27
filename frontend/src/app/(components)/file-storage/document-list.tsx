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
    Chip,
    Typography,
    Skeleton,
    Tooltip,
} from "@mui/material";
import {
    Visibility,
    Download,
    Print,
    Edit,
    Delete,
    PictureAsPdf,
    Image as ImageIcon,
    Description as FileIcon,
    SentimentVeryDissatisfied,
} from "@mui/icons-material";

export interface Document {
    id: string;
    name: string;
    description: string | null;
    category: string;
    tags: string[];
    mimetype: string;
    filesize: number;
    storagepath: string;
    storageurl?: string | null; // deprecated - use download endpoint
    createdat: string;
    updatedat: string;
}

export interface DocumentListProps {
    documents: Document[];
    isloading?: boolean;
    onpreview: (doc: Document) => void;
    ondownload: (doc: Document) => void;
    onprint: (doc: Document) => void;
    onedit: (doc: Document) => void;
    ondelete: (doc: Document) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
    contract: "계약서",
    invoice: "청구서",
    receipt: "영수증",
    report: "보고서",
    certificate: "증명서",
    form: "양식",
    notice: "안내문",
    employeecontract: "제공인력 계약서",
};

const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
};

const getFileIcon = (mimetype: string) => {
    if (mimetype.includes("pdf")) {
        return <PictureAsPdf color="error" />;
    } else if (mimetype.includes("image")) {
        return <ImageIcon color="primary" />;
    }
    return <FileIcon color="action" />;
};

export const DocumentList = ({
    documents,
    isloading = false,
    onpreview,
    ondownload,
    onprint,
    onedit,
    ondelete,
}: DocumentListProps) => {
    const rowsPerPage = 5;

    if (isloading) {
        return (
            <TableContainer>
                <Table sx={{ minWidth: 650 }}>
                    <TableHead>
                        <TableRow>
                            <TableCell>문서명</TableCell>
                            <TableCell align="center">분류</TableCell>
                            <TableCell align="center">태그</TableCell>
                            <TableCell align="center">등록일</TableCell>
                            <TableCell align="center">작업</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {Array.from({ length: rowsPerPage }).map((_, index) => (
                            <TableRow key={`skeleton-${index}`}>
                                <TableCell>
                                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                        <Skeleton variant="circular" width={24} height={24} />
                                        <Skeleton variant="text" width={150} />
                                    </Box>
                                </TableCell>
                                <TableCell align="center">
                                    <Skeleton variant="rounded" width={60} height={24} sx={{ mx: "auto" }} />
                                </TableCell>
                                <TableCell align="center">
                                    <Skeleton variant="rounded" width={80} height={24} sx={{ mx: "auto" }} />
                                </TableCell>
                                <TableCell align="center">
                                    <Skeleton variant="text" width={80} sx={{ mx: "auto" }} />
                                </TableCell>
                                <TableCell align="center">
                                    <Box sx={{ display: "flex", justifyContent: "center", gap: 1 }}>
                                        <Skeleton variant="circular" width={30} height={30} />
                                        <Skeleton variant="circular" width={30} height={30} />
                                        <Skeleton variant="circular" width={30} height={30} />
                                    </Box>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        );
    }

    if (!documents || documents.length === 0) {
        return (
            <Box
                sx={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    py: 8,
                    color: "text.secondary",
                    gap: 2,
                }}
            >
                <SentimentVeryDissatisfied sx={{ fontSize: 48, opacity: 0.5 }} />
                <Typography variant="body1">등록된 문서가 없습니다</Typography>
            </Box>
        );
    }

    return (
        <TableContainer>
            <Table sx={{ minWidth: 650 }}>
                <TableHead>
                    <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>문서명</TableCell>
                        <TableCell align="center" sx={{ fontWeight: 600 }}>분류</TableCell>
                        <TableCell align="center" sx={{ fontWeight: 600 }}>태그</TableCell>
                        <TableCell align="center" sx={{ fontWeight: 600 }}>등록일</TableCell>
                        <TableCell align="center" sx={{ fontWeight: 600 }}>작업</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {documents.map((doc) => (
                        <TableRow
                            key={doc.id}
                            hover
                            sx={{
                                "&:hover": { bgcolor: "action.hover" },
                                transition: "background-color 0.2s",
                            }}
                        >
                            <TableCell>
                                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                                    {getFileIcon(doc.mimetype)}
                                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                        {doc.name}
                                    </Typography>
                                </Box>
                            </TableCell>
                            <TableCell align="center">
                                <Chip
                                    label={CATEGORY_LABELS[doc.category] || doc.category}
                                    size="small"
                                    color="primary"
                                    variant="outlined"
                                    sx={{ borderRadius: 1 }}
                                />
                            </TableCell>
                            <TableCell align="center">
                                <Box sx={{ display: "flex", gap: 0.5, justifyContent: "center", flexWrap: "wrap" }}>
                                    {doc.tags.map((tag, idx) => (
                                        <Chip
                                            key={idx}
                                            label={tag}
                                            size="small"
                                            sx={{
                                                height: 20,
                                                fontSize: "0.7rem",
                                                bgcolor: "action.selected",
                                            }}
                                        />
                                    ))}
                                </Box>
                            </TableCell>
                            <TableCell align="center">
                                <Typography variant="body2" color="text.secondary">
                                    {formatDate(doc.createdat)}
                                </Typography>
                            </TableCell>
                            <TableCell align="center">
                                <Box sx={{ display: "flex", justifyContent: "center" }}>
                                    <Tooltip title="미리보기">
                                        <IconButton size="small" onClick={() => onpreview(doc)}>
                                            <Visibility fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title="다운로드">
                                        <IconButton size="small" onClick={() => ondownload(doc)}>
                                            <Download fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title="인쇄">
                                        <IconButton size="small" onClick={() => onprint(doc)}>
                                            <Print fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title="수정">
                                        <IconButton size="small" onClick={() => onedit(doc)}>
                                            <Edit fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title="삭제">
                                        <IconButton
                                            size="small"
                                            onClick={() => ondelete(doc)}
                                            sx={{ color: "error.main" }}
                                        >
                                            <Delete fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                </Box>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </TableContainer>
    );
};
