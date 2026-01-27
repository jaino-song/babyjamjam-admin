"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Autocomplete,
  Chip,
  IconButton,
  Box,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import SaveIcon from "@mui/icons-material/Save";

interface Document {
  id: string;
  name: string;
  description: string | null;
  category: string;
  tags: string[];
}

interface DocumentEditModalProps {
  open: boolean;
  document: Document | null;
  onClose: () => void;
  onSave: (
    id: string,
    updates: {
      name?: string;
      description?: string;
      category?: string;
      tags?: string[];
    }
  ) => void;
  isSaving?: boolean;
}

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

export function DocumentEditModal({
  open,
  document,
  onClose,
  onSave,
  isSaving = false,
}: DocumentEditModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    if (document && open) {
      setName(document.name);
      setDescription(document.description || "");
      setCategory(document.category);
      setTags(document.tags || []);
    }
  }, [document, open]);

  const handleClose = () => {
    if (!isSaving) {
      onClose();
    }
  };

  const handleSave = () => {
    if (!document) return;

    const updates: {
      name?: string;
      description?: string;
      category?: string;
      tags?: string[];
    } = {};

    if (name !== document.name) updates.name = name;
    if (description !== (document.description || "")) updates.description = description;
    if (category !== document.category) updates.category = category;
    
    if (JSON.stringify(tags) !== JSON.stringify(document.tags)) {
        updates.tags = tags;
    }

    if (Object.keys(updates).length > 0) {
      onSave(document.id, updates);
    } else {
      onClose();
    }
  };

  return (
    <Dialog 
      open={open} 
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle sx={{ m: 0, p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        문서 정보 수정
        <IconButton
          aria-label="close"
          onClick={handleClose}
          disabled={isSaving}
          sx={{
            color: (theme) => theme.palette.grey[500],
          }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      
      <DialogContent dividers>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 1 }}>
          <TextField
            label="문서 제목"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
            error={name.trim() === ""}
            helperText={name.trim() === "" ? "문서 제목을 입력해주세요" : ""}
            disabled={isSaving}
          />

          <FormControl fullWidth>
            <InputLabel id="edit-category-label">카테고리</InputLabel>
            <Select
              labelId="edit-category-label"
              value={category}
              label="카테고리"
              onChange={(e) => setCategory(e.target.value)}
              disabled={isSaving}
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
            disabled={isSaving}
          />

          <Autocomplete
            multiple
            freeSolo
            options={[]}
            value={tags}
            onChange={(_, newValue) => setTags(newValue)}
            disabled={isSaving}
            renderTags={(value: readonly string[], getTagProps) =>
              value.map((option: string, index: number) => (
                <Chip
                  variant="outlined"
                  label={option}
                  {...getTagProps({ index })}
                  key={index}
                />
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
        </Box>
      </DialogContent>

      <DialogActions sx={{ p: 2 }}>
        <Button onClick={handleClose} disabled={isSaving}>
          취소
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={isSaving || name.trim() === ""}
          startIcon={isSaving ? undefined : <SaveIcon />}
        >
          {isSaving ? "저장 중..." : "저장"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
