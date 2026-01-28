"use client";

import React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Chip,
  Typography,
  Box,
  Skeleton,
  Tooltip,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import {
  PictureAsPdf as PdfIcon,
  Image as ImageIcon,
  Description as FileIcon,
  Download as DownloadIcon,
  Print as PrintIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
} from "@mui/icons-material";
import { Document } from "@/app/hooks/use-documents";

interface DocumentListProps {
  documents: Document[];
  isLoading?: boolean;
  onPreview: (doc: Document) => void;
  onEdit: (doc: Document) => void;
  onDelete: (doc: Document) => void;
}

export const CATEGORY_LABELS: Record<string, string> = {
  contract: "계약서",
  invoice: "청구서",
  receipt: "영수증",
  report: "보고서",
  certificate: "증명서",
  form: "양식",
  notice: "안내문",
  "employee-contract": "제공인력 계약서",
};

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

export default function DocumentList({
  documents,
  isLoading = false,
  onPreview,
  onEdit,
  onDelete,
}: DocumentListProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  if (isLoading) {
    return (
      <TableContainer component={Paper} elevation={0} className="border border-gray-200">
        <Table>
          <TableHead>
            <TableRow className="bg-gray-50">
              <TableCell>문서명</TableCell>
              {!isMobile && <TableCell>카테고리</TableCell>}
              {!isMobile && <TableCell>태그</TableCell>}
              {!isMobile && <TableCell>크기</TableCell>}
              <TableCell align={isMobile ? "right" : "left"}>등록일</TableCell>
              {!isMobile && <TableCell align="right">관리</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {[1, 2, 3].map((i) => (
              <TableRow key={i}>
                <TableCell><Skeleton variant="text" width={150} /></TableCell>
                {!isMobile && <TableCell><Skeleton variant="text" width={80} /></TableCell>}
                {!isMobile && <TableCell><Skeleton variant="text" width={100} /></TableCell>}
                {!isMobile && <TableCell><Skeleton variant="text" width={60} /></TableCell>}
                <TableCell align={isMobile ? "right" : "left"}><Skeleton variant="text" width={100} /></TableCell>
                {!isMobile && <TableCell align="right"><Skeleton variant="rectangular" width={100} height={30} /></TableCell>}
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
    <TableContainer component={Paper} elevation={0} className="border border-gray-200 overflow-hidden rounded-lg">
      <Table sx={isMobile ? undefined : { minWidth: 650 }} aria-label="document table">
        <TableHead>
          <TableRow className="bg-gray-50">
            <TableCell className="font-bold text-gray-700">문서명</TableCell>
            {!isMobile && <TableCell className="font-bold text-gray-700">카테고리</TableCell>}
            {!isMobile && <TableCell className="font-bold text-gray-700">태그</TableCell>}
            {!isMobile && <TableCell className="font-bold text-gray-700">크기</TableCell>}
            <TableCell className="font-bold text-gray-700" align={isMobile ? "right" : "left"}>등록일</TableCell>
            {!isMobile && <TableCell align="right" className="font-bold text-gray-700">관리</TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {documents.map((doc) => (
            <TableRow
              key={doc.id}
              hover
              className="cursor-pointer transition-colors hover:bg-gray-50"
              onClick={() => onPreview(doc)}
            >
              <TableCell component="th" scope="row">
                <Box className="flex items-center gap-3">
                  {getFileIcon(doc.mimeType)}
                  <div className="flex flex-col">
                    <Typography variant="body2" className="font-medium text-gray-900">
                      {doc.name}
                    </Typography>
                    {doc.description && (
                      <Typography variant="caption" className="text-gray-500 truncate max-w-[200px]">
                        {doc.description}
                      </Typography>
                    )}
                  </div>
                </Box>
              </TableCell>
              {!isMobile && (
                <TableCell>
                  <Chip
                    label={CATEGORY_LABELS[doc.category] || doc.category}
                    size="small"
                    className="bg-gray-100 text-gray-700 font-medium"
                  />
                </TableCell>
              )}
              {!isMobile && (
                <TableCell>
                  <div className="flex gap-1 flex-wrap">
                    {doc.tags?.slice(0, 2).map((tag, index) => (
                      <span key={index} className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-xs font-medium">
                        #{tag}
                      </span>
                    ))}
                    {doc.tags?.length > 2 && (
                      <span className="text-xs text-gray-400 self-center">
                        +{doc.tags.length - 2}
                      </span>
                    )}
                  </div>
                </TableCell>
              )}
              {!isMobile && (
                <TableCell>
                  <Typography variant="body2" className="text-gray-600 font-mono text-xs">
                    {formatFileSize(doc.fileSize)}
                  </Typography>
                </TableCell>
              )}
              <TableCell align={isMobile ? "right" : "left"}>
                <Typography variant="body2" className="text-gray-600">
                  {formatDate(doc.createdAt)}
                </Typography>
              </TableCell>
              {!isMobile && (
                <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-1">
                    <Tooltip title="다운로드">
                      <IconButton
                        size="small"
                        className="text-gray-500 hover:text-blue-600"
                        onClick={(e) => {
                          e.stopPropagation();
                          // Download logic would go here or be handled by parent
                          // Since props don't have onDownload, we might assume onPreview or separate handling
                          // Requirement said "action buttons: download...", but props interface didn't list onDownload
                          // I will add a default handler that opens the file if storageUrl exists
                          if (doc.storageUrl) window.open(doc.storageUrl, '_blank');
                        }}
                      >
                        <DownloadIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="인쇄">
                      <IconButton
                        size="small"
                        className="text-gray-500 hover:text-gray-800"
                        onClick={(e) => {
                          e.stopPropagation();
                          // Print logic
                          window.print();
                        }}
                      >
                        <PrintIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="수정">
                      <IconButton
                        size="small"
                        className="text-gray-500 hover:text-green-600"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEdit(doc);
                        }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="삭제">
                      <IconButton
                        size="small"
                        className="text-gray-500 hover:text-red-600"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(doc);
                        }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </div>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
