'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { Box, TextField, Button, Chip, Alert, Paper, Typography, Snackbar } from '@mui/material';
import { Save as SaveIcon } from '@mui/icons-material';
import type { SystemTemplate } from '../types';
import { useUpdateSystemTemplate } from '../hooks';
import { extractVariables } from '@/lib/template-utils';
import { SAMPLE_DATA, TemplatePreview } from './TemplatePreview';

interface Props { template: SystemTemplate; }

export function SystemTemplateEditor({ template }: Props) {
  const [content, setContent] = useState(template.content);
  const [errors, setErrors] = useState<string[]>([]);
  const [showSuccess, setShowSuccess] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const updateMutation = useUpdateSystemTemplate();

  const usedVariables = useMemo(() => extractVariables(content), [content]);
  const requiredKeys = template.requiredVariables.map(v => v.key);
  const previewData = useMemo(() => SAMPLE_DATA[template.templateKey] ?? {}, [template.templateKey]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const missing = requiredKeys.filter(k => !usedVariables.includes(k));
      const unknown = usedVariables.filter(k => !requiredKeys.includes(k));
      const newErrors: string[] = [];
      missing.forEach(v => newErrors.push(`필수 변수 누락: {{${v}}}`));
      unknown.forEach(v => newErrors.push(`정의되지 않은 변수: {{${v}}}`));
      setErrors(newErrors);
    }, 300);
    return () => clearTimeout(timer);
  }, [content, requiredKeys, usedVariables]);

  const isValid = errors.length === 0;

  const insertVariable = (key: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newContent = content.slice(0, start) + `{{${key}}}` + content.slice(end);
    setContent(newContent);
  };

  const handleSave = async () => {
    await updateMutation.mutateAsync({ key: template.templateKey, content });
    setShowSuccess(true);
  };

  return (
    <Box display="flex" gap={2} flexDirection={{ xs: 'column', md: 'row' }}>
      <Paper sx={{ p: 2, minWidth: 200 }}>
        <Typography variant="subtitle2" mb={1}>변수 삽입</Typography>
        <Box display="flex" flexWrap="wrap" gap={1}>
          {template.requiredVariables.map((v) => (
            <Chip key={v.key} label={v.label} size="small"
              color={usedVariables.includes(v.key) ? 'success' : 'error'}
              variant={usedVariables.includes(v.key) ? 'filled' : 'outlined'}
              onClick={() => insertVariable(v.key)} sx={{ cursor: 'pointer' }} />
          ))}
        </Box>
      </Paper>
      <Box flex={1}>
        {errors.length > 0 && <Alert severity="error" sx={{ mb: 2 }}>{errors.map((e, i) => <div key={i}>{e}</div>)}</Alert>}
        <TextField inputRef={textareaRef} multiline fullWidth minRows={15} value={content}
          onChange={(e) => setContent(e.target.value)} />
        <Box mt={2}>
          <Button variant="contained" startIcon={<SaveIcon />} disabled={!isValid || updateMutation.isPending} onClick={handleSave}>
            {updateMutation.isPending ? '저장 중...' : '저장'}
          </Button>
        </Box>
      </Box>
      <TemplatePreview content={content} data={previewData} templateKey={template.templateKey} />
      <Snackbar open={showSuccess} autoHideDuration={3000} onClose={() => setShowSuccess(false)} message="저장되었습니다" />
    </Box>
  );
}
