"use client";

import React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Typography,
  Box,
  Skeleton,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import {
  PictureAsPdf as PdfIcon,
  Image as ImageIcon,
  Description as FileIcon,
} from "@mui/icons-material";
import { Document } from "@/app/hooks/use-documents";
import { DocumentCategory } from "@/app/hooks/use-document-categories";

interface DocumentListProps {
  documents: Document[];
  categories: DocumentCategory[];
  isLoading?: boolean;
  onPreview: (doc: Document) => void;
  onEdit: (doc: Document) => void;
  onDelete: (doc: Document) => void;
}

export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

export const formatDate = (dateString: string): string => {
  return new Date(dateString).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
};

const getFileIcon = (mimeType: string) => {
  if (mimeType.includes("pdf")) {
    return <PdfIcon className="text-red-500" />;
  }
  if (mimeType.includes("image")) {
    return <ImageIcon className="text-blue-500" />;
  }
  return <FileIcon className="text-gray-500" />;
};

function getCategoryLabel(categoryId: string, categories: DocumentCategory[]): string {
  const category = categories.find((c) => c.id === categoryId);
  return category?.label || categoryId;
}

export default function DocumentList({
  documents,
  categories,
  isLoading = false,
  onPreview,
  onEdit,
  onDelete,
}: DocumentListProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  if (isLoading) {
    return (
      <TableContainer>
        <Table sx={{ tableLayout: "fixed", width: "100%" }}>
          <TableHead>
            <TableRow>
              <TableCell
                align="center"
                sx={{ fontWeight: 500, color: "rgba(0, 0, 0, 0.6)", fontSize: "0.875rem" }}
              >
                문서명
              </TableCell>
              <TableCell
                align="center"
                sx={{ fontWeight: 500, color: "rgba(0, 0, 0, 0.6)", fontSize: "0.875rem", width: "110px", whiteSpace: "nowrap" }}
              >
                등록일
              </TableCell>
              {!isMobile && (
                <TableCell
                  align="center"
                  sx={{ fontWeight: 500, color: "rgba(0, 0, 0, 0.6)", fontSize: "0.875rem", width: "120px" }}
                >
                  카테고리
                </TableCell>
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {[1, 2, 3].map((i) => (
              <TableRow key={i}>
                <TableCell align="center"><Skeleton variant="text" width="80%" /></TableCell>
                <TableCell align="center"><Skeleton variant="text" width="80%" /></TableCell>
                {!isMobile && <TableCell align="center"><Skeleton variant="text" width="60%" /></TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );
  }

  if (documents.length === 0) {
    return (
      <Box className="flex flex-col items-center justify-center py-12 text-gray-500 border border-gray-200 rounded-lg bg-gray-50">
        <FileIcon className="text-gray-300 w-16 h-16 mb-4" style={{ fontSize: 64 }} />
        <Typography variant="h6" className="text-gray-600 mb-1">
          등록된 문서가 없습니다
        </Typography>
        <Typography variant="body2" className="text-gray-400">
          새로운 문서를 업로드해보세요
        </Typography>
      </Box>
    );
  }

  return (
    <TableContainer>
      <Table sx={{ tableLayout: "fixed", width: "100%" }}>
        <TableHead>
          <TableRow>
            <TableCell
              align="center"
              sx={{
                fontWeight: 500,
                color: "rgba(0, 0, 0, 0.6)",
                fontSize: "0.875rem",
              }}
            >
              문서명
            </TableCell>
            <TableCell
              align="center"
              sx={{
                fontWeight: 500,
                color: "rgba(0, 0, 0, 0.6)",
                fontSize: "0.875rem",
                width: "110px",
                whiteSpace: "nowrap",
              }}
            >
              등록일
            </TableCell>
            {!isMobile && (
              <TableCell
                align="center"
                sx={{
                  fontWeight: 500,
                  color: "rgba(0, 0, 0, 0.6)",
                  fontSize: "0.875rem",
                  width: "120px",
                }}
              >
                카테고리
              </TableCell>
            )}
          </TableRow>
        </TableHead>
        <TableBody>
          {documents.map((doc) => (
            <TableRow
              key={doc.id}
              hover
              onClick={() => onPreview(doc)}
              sx={{ cursor: "pointer", "&:hover": { bgcolor: "rgba(0, 0, 0, 0.04)" } }}
            >
              <TableCell
                align="center"
                sx={{ fontSize: "0.875rem", color: "rgba(0, 0, 0, 0.87)", pl: 3, pr: 1 }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, justifyContent: "left" }}>
                  {getFileIcon(doc.mimeType)}
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {doc.name}
                  </Typography>
                </Box>
              </TableCell>
              <TableCell
                align="center"
                sx={{ fontSize: "0.875rem", color: "rgba(0, 0, 0, 0.87)", px: 1 }}
              >
                {formatDate(doc.createdAt)}
              </TableCell>
              {!isMobile && (
                <TableCell align="center" sx={{ px: 1 }}>
                  <Chip
                    label={getCategoryLabel(doc.categoryId, categories)}
                    size="small"
                    sx={{ bgcolor: "rgba(0, 0, 0, 0.08)", color: "rgba(0, 0, 0, 0.87)" }}
                  />
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
