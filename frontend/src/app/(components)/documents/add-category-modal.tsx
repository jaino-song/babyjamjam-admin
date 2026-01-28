"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Box,
  IconButton,
  Typography,
  Stack,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

interface AddCategoryModalProps {
  open: boolean;
  onClose: () => void;
  onAdd: (category: { value: string; label: string; color: string }) => Promise<void>;
  existingColors: string[];
  isLoading?: boolean;
}

// MUI standard colors + 5 additional unique colors
const COLOR_OPTIONS = [
  // Current filter colors (MUI standard)
  { value: "default", label: "기본", hex: "#9e9e9e" },
  { value: "primary", label: "파랑", hex: "#1976d2" },
  { value: "secondary", label: "보라", hex: "#9c27b0" },
  { value: "success", label: "초록", hex: "#2e7d32" },
  { value: "warning", label: "주황", hex: "#ed6c02" },
  { value: "error", label: "빨강", hex: "#d32f2f" },
  { value: "info", label: "하늘", hex: "#0288d1" },
  // 5 additional unique colors
  { value: "#e91e63", label: "핑크", hex: "#e91e63" },
  { value: "#00bcd4", label: "청록", hex: "#00bcd4" },
  { value: "#ff9800", label: "오렌지", hex: "#ff9800" },
  { value: "#795548", label: "갈색", hex: "#795548" },
  { value: "#607d8b", label: "회청", hex: "#607d8b" },
];

export function AddCategoryModal({
  open,
  onClose,
  onAdd,
  existingColors,
  isLoading = false,
}: AddCategoryModalProps) {
  const [name, setName] = useState("");
  const [selectedColor, setSelectedColor] = useState("");

  const handleClose = () => {
    if (isLoading) return;
    setName("");
    setSelectedColor("");
    onClose();
  };

  const handleAdd = async () => {
    if (!name.trim() || !selectedColor || isLoading) return;

    const value = name.trim().toLowerCase().replace(/\s+/g, "-");
    await onAdd({
      value,
      label: name.trim(),
      color: selectedColor,
    });
    setName("");
    setSelectedColor("");
  };

  // Filter out already used colors
  const availableColors = COLOR_OPTIONS.filter(
    (color) => !existingColors.includes(color.value)
  );

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>
        태그 추가
        <IconButton
          aria-label="close"
          onClick={handleClose}
          sx={{
            position: "absolute",
            right: 8,
            top: 8,
            color: (theme) => theme.palette.grey[500],
          }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3} sx={{ mt: 1 }}>
          <TextField
            label="태그 이름"
            fullWidth
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder="예: 중요문서"
          />

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1.5, color: "text.secondary" }}>
              칩 색상 선택
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>
              {availableColors.map((color) => (
                <Box
                  key={color.value}
                  onClick={() => setSelectedColor(color.value)}
                  sx={{
                    width: 48,
                    height: 48,
                    borderRadius: 2,
                    bgcolor: color.hex,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: selectedColor === color.value ? "3px solid #000" : "2px solid transparent",
                    transition: "all 0.2s",
                    "&:hover": {
                      transform: "scale(1.1)",
                      boxShadow: 2,
                    },
                  }}
                  title={color.label}
                />
              ))}
            </Box>
            {selectedColor && (
              <Typography variant="caption" sx={{ mt: 1, display: "block", color: "text.secondary" }}>
                선택됨: {COLOR_OPTIONS.find((c) => c.value === selectedColor)?.label}
              </Typography>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={isLoading}>취소</Button>
        <Button
          onClick={handleAdd}
          variant="contained"
          disabled={!name.trim() || !selectedColor || isLoading}
        >
          {isLoading ? "추가 중..." : "추가"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
