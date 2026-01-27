"use client";

import { useCallback, useState } from "react";
import {
  Box,
  Typography,
  Paper,
  Alert,
  CircularProgress,
} from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";

// 허용되는 파일 형식
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "application/pdf"];
const ALLOWED_EXTENSIONS = ".png, .jpg, .jpeg, .pdf";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

interface ImageDropzoneProps {
  onFileSelect: (file: File) => void;
  isLoading?: boolean;
  error?: string | null;
}

export function ImageDropzone({
  onFileSelect,
  isLoading = false,
  error,
}: ImageDropzoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const validateFile = useCallback((file: File): string | null => {
    // 파일 형식 검증
    if (!ALLOWED_TYPES.includes(file.type)) {
      return `허용되지 않는 파일 형식입니다. 허용 형식: ${ALLOWED_EXTENSIONS}`;
    }

    // 파일 크기 검증
    if (file.size > MAX_FILE_SIZE) {
      const sizeMB = (file.size / 1024 / 1024).toFixed(2);
      return `파일 크기가 10MB를 초과합니다. 현재 크기: ${sizeMB}MB`;
    }

    return null;
  }, []);

  const handleFile = useCallback(
    (file: File) => {
      const error = validateFile(file);
      if (error) {
        setValidationError(error);
        setSelectedFile(null);
        return;
      }

      setValidationError(null);
      setSelectedFile(file);
      onFileSelect(file);
    },
    [validateFile, onFileSelect],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        handleFile(files[0]);
      }
    },
    [handleFile],
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        handleFile(files[0]);
      }
    },
    [handleFile],
  );

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  return (
    <Box data-component="ImageDropzone">
      {/* 에러 표시 */}
      {(validationError || error) && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {validationError || error}
        </Alert>
      )}

      {/* 드롭존 */}
      <Paper
        data-component="image-dropzone-paper"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        sx={{
          position: "relative",
          p: 4,
          border: "2px dashed",
          borderColor: isDragOver
            ? "primary.main"
            : validationError
              ? "error.main"
              : "divider",
          borderRadius: 2,
          backgroundColor: isDragOver
            ? "action.hover"
            : "background.paper",
          cursor: isLoading ? "wait" : "pointer",
          transition: "all 0.2s ease-in-out",
          "&:hover": {
            borderColor: isLoading ? "divider" : "primary.main",
            backgroundColor: isLoading ? "background.paper" : "action.hover",
          },
        }}
      >
        <input
          type="file"
          accept={ALLOWED_EXTENSIONS}
          onChange={handleFileInputChange}
          disabled={isLoading}
          style={{
            position: "absolute",
            width: "100%",
            height: "100%",
            top: 0,
            left: 0,
            opacity: 0,
            cursor: isLoading ? "wait" : "pointer",
          }}
        />

        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
            position: "relative",
          }}
        >
          {isLoading ? (
            <>
              <CircularProgress size={48} />
              <Typography variant="body1" color="text.secondary">
                이미지 분석 중...
              </Typography>
            </>
          ) : selectedFile ? (
            <>
              <InsertDriveFileIcon
                sx={{ fontSize: 48, color: "primary.main" }}
              />
              <Box textAlign="center">
                <Typography variant="body1" fontWeight="medium">
                  {selectedFile.name}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {formatFileSize(selectedFile.size)}
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary">
                다른 파일을 선택하려면 클릭하거나 드래그하세요
              </Typography>
            </>
          ) : (
            <>
              <CloudUploadIcon
                sx={{ fontSize: 48, color: "text.secondary" }}
              />
              <Box textAlign="center">
                <Typography variant="body1" fontWeight="medium">
                  바우처 요금표 이미지를 업로드하세요
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  드래그 앤 드롭 또는 클릭하여 파일 선택
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary">
                지원 형식: PNG, JPG, JPEG, PDF (최대 10MB)
              </Typography>
            </>
          )}
        </Box>
      </Paper>

      {/* 업로드 가이드 */}
      <Box sx={{ mt: 2, pl: 1 }}>
        <Typography variant="caption" color="text.secondary" component="div">
          <strong>업로드 가이드:</strong>
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          component="ul"
          sx={{ mt: 0.5, pl: 2 }}
        >
          <li>표 전체가 보이도록 캡처해주세요</li>
          <li>단위 표시(천원/원)가 포함되어야 합니다</li>
          <li>단축, 표준, 연장 헤더가 보여야 합니다</li>
        </Typography>
      </Box>
    </Box>
  );
}
