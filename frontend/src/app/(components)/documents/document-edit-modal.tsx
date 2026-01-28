import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Button,
  Chip,
  Box,
  Stack,
  IconButton
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { Document } from "@/app/hooks/use-documents";

interface DocumentEditModalProps {
  open: boolean;
  onClose: () => void;
  doc: Document | null;
  onSave: (id: string, params: { name?: string; description?: string; category?: string; tags?: string[] }) => Promise<void>;
  isLoading?: boolean;
}

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

export function DocumentEditModal({
  open,
  onClose,
  doc,
  onSave,
  isLoading = false,
}: DocumentEditModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  useEffect(() => {
    if (doc) {
      setName(doc.name || '');
      setDescription(doc.description || '');
      setCategory(doc.category || '');
      setTags(doc.tags || []);
    } else {
      setName('');
      setDescription('');
      setCategory('');
      setTags([]);
    }
    setTagInput('');
  }, [doc, open]);

  const handleSave = async () => {
    if (!doc) return;
    
    await onSave(doc.id, {
      name,
      description,
      category,
      tags
    });
  };

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = tagInput.trim();
      if (trimmed && !tags.includes(trimmed)) {
        setTags([...tags, trimmed]);
        setTagInput('');
      }
    }
  };

  const handleDeleteTag = (tagToDelete: string) => {
    setTags(tags.filter((tag) => tag !== tagToDelete));
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        문서 정보 수정
        <IconButton
          aria-label="close"
          onClick={onClose}
          sx={{
            position: 'absolute',
            right: 8,
            top: 8,
            color: (theme) => theme.palette.grey[500],
          }}
          disabled={isLoading}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3} sx={{ mt: 1 }}>
          <TextField
            label="문서명"
            fullWidth
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isLoading}
            autoFocus
          />
          
          <TextField
            select
            label="카테고리"
            fullWidth
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={isLoading}
          >
            {CATEGORIES.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>

          <Box>
            <TextField
              label="태그 (Enter로 추가)"
              fullWidth
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              disabled={isLoading}
              placeholder="태그 입력 후 Enter"
              helperText="태그를 입력하고 Enter키를 눌러주세요"
            />
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
              {tags.map((tag) => (
                <Chip
                  key={tag}
                  label={tag}
                  onDelete={isLoading ? undefined : () => handleDeleteTag(tag)}
                  disabled={isLoading}
                />
              ))}
            </Box>
          </Box>
          
          <TextField
            label="설명"
            fullWidth
            multiline
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isLoading}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isLoading}>
          취소
        </Button>
        <Button 
          onClick={handleSave} 
          variant="contained" 
          disabled={isLoading}
        >
          {isLoading ? '저장 중...' : '저장'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
