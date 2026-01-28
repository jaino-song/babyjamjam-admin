"use client";

import { useCallback, useState, useEffect } from "react";
import {
  Box,
  Typography,
  Paper,
  Alert,
  CircularProgress,
  TextField,
  MenuItem,
  Button,
  LinearProgress,
  Stack,
  Chip,
  IconButton,
  Tooltip
} from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import CloseIcon from "@mui/icons-material/Close";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import ImageIcon from "@mui/icons-material/Image";
import DescriptionIcon from "@mui/icons-material/Description";

const ALLOWED_TYPES = [
  "image/png", 
  "image/jpeg", 
  "image/jpg", 
  "application/pdf"
];
const ALLOWED_EXTENSIONS = ".png, .jpg, .jpeg, .pdf";
const MAX_FILE_SIZE = 25 * 1024 * 1024;

const CATEGORIES = [
  { value: 'contract', label: '계약서' },
  { value: 'invoice', label: '청구서' },
  { value: 'receipt', label: '영수증' },
  { value: 'report', label: '보고서' },
  { value: 'certificate', label: '증명서' },
  { value: 'form', label: '양식' },
  { value: 'notice', label: '안내문' },
  { value: 'employee-contract', label: '제공인력 계약서' },
];

interface DocumentDropzoneProps {
  onUpload: (params: { 
    file: File; 
    name: string; 
    description?: string; 
    category: string; 
    tags: string[] 
  }) => Promise<void>;
  isLoading?: boolean;
  uploadProgress?: number;
}

export function DocumentDropzone({
  onUpload,
  isLoading = false,
  uploadProgress = 0,
}: DocumentDropzoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

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

  const handleFile = useCallback(
    (file: File) => {
      const error = validateFile(file);
      if (error) {
        setValidationError(error);
        return;
      }

      setValidationError(null);
      setSelectedFile(file);
      
      const fileNameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
      setName(fileNameWithoutExt);
      
      if (file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        setPreviewUrl(url);
      } else {
        setPreviewUrl(null);
      }
    },
    [validateFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isLoading) {
      setIsDragOver(true);
    }
  }, [isLoading]);

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

      if (isLoading) return;

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        handleFile(files[0]);
      }
    },
    [handleFile, isLoading],
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

  const handleRemoveFile = useCallback(() => {
    setSelectedFile(null);
    setValidationError(null);
    setName("");
    setDescription("");
    setCategory("");
    setTags([]);
    setTagInput("");
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  }, [previewUrl]);

  const handleAddTag = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      e.preventDefault();
      if (!tags.includes(tagInput.trim())) {
        setTags([...tags, tagInput.trim()]);
      }
      setTagInput("");
    }
  };

  const handleDeleteTag = (tagToDelete: string) => {
    setTags(tags.filter((tag) => tag !== tagToDelete));
  };

  const handleSubmit = async () => {
    if (!selectedFile || !name || !category) return;
    
    await onUpload({
      file: selectedFile,
      name,
      description: description || undefined,
      category,
      tags
    });
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  const getFileIcon = () => {
    if (selectedFile?.type === 'application/pdf') {
      return <PictureAsPdfIcon sx={{ fontSize: 40, color: "error.main" }} />;
    }
    if (selectedFile?.type.startsWith('image/')) {
      return <ImageIcon sx={{ fontSize: 40, color: "primary.main" }} />;
    }
    return <InsertDriveFileIcon sx={{ fontSize: 40, color: "action.active" }} />;
  };

  return (
    <Box data-component="DocumentDropzone" className="w-full">
      {validationError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {validationError}
        </Alert>
      )}

      {!selectedFile ? (
        <Paper
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          elevation={0}
          sx={{
            position: "relative",
            p: 6,
            border: "2px dashed",
            borderColor: isDragOver
              ? "primary.main"
              : "divider",
            borderRadius: 2,
            backgroundColor: isDragOver
              ? "action.hover"
              : "background.default",
            cursor: isLoading ? "wait" : "pointer",
            transition: "all 0.2s ease-in-out",
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            "&:hover": {
              borderColor: isLoading ? "divider" : "primary.main",
              backgroundColor: isLoading ? "background.default" : "action.hover",
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
          
          <CloudUploadIcon sx={{ fontSize: 64, color: "text.secondary", opacity: 0.5 }} />
          <Box textAlign="center">
            <Typography variant="h6" fontWeight="medium" gutterBottom>
              파일을 드래그하거나 클릭하여 업로드
            </Typography>
            <Typography variant="body2" color="text.secondary">
              지원 형식: PDF, PNG, JPG (최대 25MB)
            </Typography>
          </Box>
        </Paper>
      ) : (
        <Paper 
          elevation={0} 
          sx={{  
            p: 3, 
            border: '1px solid', 
            borderColor: 'divider',
            borderRadius: 2
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 4 }}>
            {previewUrl ? (
              <Box 
                component="img"
                src={previewUrl}
                alt="Preview"
                sx={{ 
                  width: 80, 
                  height: 80, 
                  objectFit: 'cover', 
                  borderRadius: 1,
                  border: '1px solid',
                  borderColor: 'divider'
                }}
              />
            ) : (
              <Box sx={{ 
                width: 80, 
                height: 80, 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                bgcolor: 'action.hover',
                borderRadius: 1
              }}>
                {getFileIcon()}
              </Box>
            )}
            
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle1" fontWeight="bold">
                {selectedFile.name}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {formatFileSize(selectedFile.size)}
              </Typography>
            </Box>

            <IconButton onClick={handleRemoveFile} disabled={isLoading} size="small">
              <CloseIcon />
            </IconButton>
          </Box>

          <Stack spacing={3}>
            <TextField
              label="문서 제목"
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
              required
              disabled={isLoading}
              size="small"
            />

            <TextField
              select
              label="카테고리"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              fullWidth
              required
              disabled={isLoading}
              size="small"
            >
              {CATEGORIES.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>

            <Box>
              <TextField
                label="태그"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleAddTag}
                placeholder="태그 입력 후 Enter"
                fullWidth
                disabled={isLoading}
                size="small"
                helperText="Enter 키를 눌러 태그를 추가하세요"
              />
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
                {tags.map((tag, index) => (
                  <Chip
                    key={index}
                    label={tag}
                    onDelete={() => handleDeleteTag(tag)}
                    disabled={isLoading}
                    size="small"
                  />
                ))}
              </Box>
            </Box>

            <TextField
              label="설명 (선택사항)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              multiline
              rows={3}
              fullWidth
              disabled={isLoading}
              size="small"
            />

            {isLoading && (
              <Box sx={{ width: '100%' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="body2" color="text.secondary">업로드 중...</Typography>
                  <Typography variant="body2" color="text.secondary">{Math.round(uploadProgress)}%</Typography>
                </Box>
                <LinearProgress variant="determinate" value={uploadProgress} />
              </Box>
            )}

            <Button
              variant="contained"
              onClick={handleSubmit}
              disabled={!name || !category || isLoading}
              fullWidth
              size="large"
              startIcon={isLoading ? <CircularProgress size={20} color="inherit" /> : <CloudUploadIcon />}
            >
              {isLoading ? "업로드 중..." : "문서 업로드"}
            </Button>
          </Stack>
        </Paper>
      )}
    </Box>
  );
}
