"use client";

import { useCallback, useState } from "react";
import {
  Box,
  Typography,
  Paper,
  Alert,
  TextField,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Autocomplete,
  Button,
  LinearProgress,
  IconButton,
  Chip,
} from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import ImageIcon from "@mui/icons-material/Image";
import CloseIcon from "@mui/icons-material/Close";
import UploadIcon from "@mui/icons-material/Upload";

// Configuration
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "application/pdf"];
const ALLOWED_EXTENSIONS = ".png, .jpg, .jpeg, .pdf";
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

const CATEGORIES = [
  { value: "contract", label: "계약서" },
  { value: "invoice", label: "청구서" },
  { value: "receipt", label: "영수증" },
  { value: "report", label: "보고서" },
  { value: "certificate", label: "증명서" },
  { value: "form", label: "양식" },
  { value: "notice", label: "안내문" },
  { value: "employeecontract", label: "제공인력 계약서" },
];

interface DocumentDropzoneProps {
  onUpload: (params: {
    file: File;
    name: string;
    description?: string;
    category: string;
    tags: string[];
  }) => void;
  isLoading?: boolean;
  uploadProgress?: number; // 0-100
  error?: string | null;
}

export function DocumentDropzone({
  onUpload,
  isLoading = false,
  uploadProgress = 0,
  error,
}: DocumentDropzoneProps) {
  // Drag & Drop State
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  // Validation Logic
  const validateFile = useCallback((file: File): string | null => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return `허용되지 않는 파일 형식입니다. 허용 형식: ${ALLOWED_EXTENSIONS}`;
    }
    if (file.size > MAX_FILE_SIZE) {
      const sizeMB = (file.size / 1024 / 1024).toFixed(2);
      return `파일 크기가 25MB를 초과합니다. 현재 크기: ${sizeMB}MB`;
    }
    return null;
  }, []);

  // File Handler
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
      setName(file.name); // Default name to filename
    },
    [validateFile]
  );

  // Drag Events
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
    [handleFile]
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        handleFile(files[0]);
      }
    },
    [handleFile]
  );

  const handleRemoveFile = useCallback(() => {
    setSelectedFile(null);
    setName("");
    setDescription("");
    setCategory("");
    setTags([]);
    setValidationError(null);
  }, []);

  const handleSubmit = useCallback(() => {
    if (!selectedFile || !category) return;

    onUpload({
      file: selectedFile,
      name,
      description,
      category,
      tags,
    });
  }, [selectedFile, name, description, category, tags, onUpload]);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  const getFileIcon = (type: string) => {
    if (type.includes("pdf")) return <PictureAsPdfIcon sx={{ fontSize: 40, color: "error.main" }} />;
    if (type.includes("image")) return <ImageIcon sx={{ fontSize: 40, color: "primary.main" }} />;
    return <InsertDriveFileIcon sx={{ fontSize: 40, color: "action.active" }} />;
  };

  return (
    <Box sx={{ width: "100%" }}>
      {/* Global Error */}
      {(validationError || error) && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {validationError || error}
        </Alert>
      )}

      {!selectedFile ? (
        // Dropzone Mode
        <Paper
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          variant="outlined"
          sx={{
            position: "relative",
            p: 6,
            borderStyle: "dashed",
            borderWidth: 2,
            borderColor: isDragOver ? "primary.main" : "divider",
            backgroundColor: isDragOver ? "action.hover" : "background.paper",
            cursor: isLoading ? "wait" : "pointer",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
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
          <CloudUploadIcon sx={{ fontSize: 64, color: isDragOver ? "primary.main" : "text.secondary" }} />
          <Box textAlign="center">
            <Typography variant="h6" color="text.primary" gutterBottom>
              문서 업로드
            </Typography>
            <Typography variant="body2" color="text.secondary">
              파일을 이곳에 드래그하거나 클릭하여 선택하세요
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
              지원 형식: PDF, JPG, PNG (최대 25MB)
            </Typography>
          </Box>
        </Paper>
      ) : (
        // Form Mode
        <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {/* File Preview Card */}
          <Paper
            variant="outlined"
            sx={{
              p: 2,
              display: "flex",
              alignItems: "center",
              gap: 2,
              borderColor: "primary.main",
              backgroundColor: "primary.50", // Light blue tint
            }}
          >
            {getFileIcon(selectedFile.type)}
            <Box sx={{ flex: 1, overflow: "hidden" }}>
              <Typography variant="subtitle2" noWrap>
                {selectedFile.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {formatFileSize(selectedFile.size)}
              </Typography>
            </Box>
            <IconButton onClick={handleRemoveFile} size="small" disabled={isLoading}>
              <CloseIcon />
            </IconButton>
          </Paper>

          {/* Progress Bar */}
          {isLoading && (
            <Box sx={{ width: "100%" }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                  업로드 중...
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {Math.round(uploadProgress)}%
                </Typography>
              </Box>
              <LinearProgress variant="determinate" value={uploadProgress} />
            </Box>
          )}

          {/* Metadata Form */}
          <Paper variant="outlined" sx={{ p: 3, display: "flex", flexDirection: "column", gap: 3 }}>
            <TextField
              label="문서 제목"
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
              required
              disabled={isLoading}
            />

            <FormControl fullWidth required>
              <InputLabel id="category-label">카테고리</InputLabel>
              <Select
                labelId="category-label"
                value={category}
                label="카테고리"
                onChange={(e) => setCategory(e.target.value)}
                disabled={isLoading}
              >
                {CATEGORIES.map((cat) => (
                  <MenuItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              label="설명"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              multiline
              rows={3}
              fullWidth
              disabled={isLoading}
            />

            <Autocomplete
              multiple
              freeSolo
              options={[]} // No preset options, purely free solo
              value={tags}
              onChange={(_, newValue) => setTags(newValue)}
              disabled={isLoading}
              renderTags={(value: readonly string[], getTagProps) =>
                value.map((option: string, index: number) => (
                  <Chip variant="outlined" label={option} {...getTagProps({ index })} key={index} />
                ))
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="태그"
                  placeholder="태그 입력 후 Enter"
                  helperText="태그를 입력하고 Enter를 누르세요"
                />
              )}
            />

            <Button
              variant="contained"
              size="large"
              startIcon={<UploadIcon />}
              onClick={handleSubmit}
              disabled={!category || !name || isLoading}
              fullWidth
              sx={{ mt: 1 }}
            >
              업로드
            </Button>
          </Paper>
        </Box>
      )}
    </Box>
  );
}
