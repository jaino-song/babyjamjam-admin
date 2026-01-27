'use client';

import { useState } from 'react';
import {
  Box,
  TextField,
  Button,
  Chip,
  Typography,
  Alert,
  Snackbar,
  CircularProgress,
  Paper,
  Stack,
} from '@mui/material';
import { Add } from '@mui/icons-material';
import { useUpdateSystemTemplate } from '../hooks';
import type { SystemTemplate, CustomVariable } from '../types';

interface Props {
  template: SystemTemplate;
}

export function SystemTemplateEditor({ template }: Props) {
  const [content, setContent] = useState(template.content);
  const [customVariables, setCustomVariables] = useState<CustomVariable[]>(
    template.customVariables || []
  );
  const [newVariable, setNewVariable] = useState({ key: '', label: '' });
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error';
  }>({
    open: false,
    message: '',
    severity: 'success',
  });

  const updateMutation = useUpdateSystemTemplate();

  const handleAddCustomVariable = () => {
    if (!newVariable.key.trim() || !newVariable.label.trim()) {
      setSnackbar({
        open: true,
        message: '변수 키와 레이블을 입력해주세요.',
        severity: 'error',
      });
      return;
    }

    // Check for duplicate keys
    if (customVariables.some((v) => v.key === newVariable.key)) {
      setSnackbar({
        open: true,
        message: '이미 존재하는 변수 키입니다.',
        severity: 'error',
      });
      return;
    }

    setCustomVariables([
      ...customVariables,
      {
        key: newVariable.key,
        label: newVariable.label,
        required: true,
      },
    ]);
    setNewVariable({ key: '', label: '' });
  };

  const handleRemoveCustomVariable = (key: string) => {
    setCustomVariables(customVariables.filter((v) => v.key !== key));
  };

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({
        key: template.templateKey,
        content,
        customVariables,
      });
      setSnackbar({
        open: true,
        message: '템플릿이 저장되었습니다.',
        severity: 'success',
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : '저장 중 오류가 발생했습니다.';
      setSnackbar({
        open: true,
        message: errorMessage,
        severity: 'error',
      });
    }
  };

  const hasChanges =
    content !== template.content ||
    JSON.stringify(customVariables) !== JSON.stringify(template.customVariables);

  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {/* Required Variables Section */}
        {template.requiredVariables && template.requiredVariables.length > 0 && (
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
              필수 변수
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {template.requiredVariables.map((variable) => (
                <Chip
                  key={variable.key}
                  label={`${variable.label} (${variable.key})`}
                  variant="outlined"
                  color="primary"
                  icon={<Typography variant="caption">*</Typography>}
                  sx={{
                    '& .MuiChip-label': {
                      fontSize: '0.875rem',
                    },
                  }}
                />
              ))}
            </Box>
            {template.requiredVariables.some((v) => v.description) && (
              <Paper
                sx={{
                  mt: 1.5,
                  p: 1.5,
                  bgcolor: 'info.lighter',
                  border: '1px solid',
                  borderColor: 'info.light',
                }}
              >
                {template.requiredVariables
                  .filter((v) => v.description)
                  .map((variable) => (
                    <Typography key={variable.key} variant="caption" display="block" sx={{ mb: 0.5 }}>
                      <strong>{variable.label}:</strong> {variable.description}
                    </Typography>
                  ))}
              </Paper>
            )}
          </Box>
        )}

        {/* Content Editor */}
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
            템플릿 내용
          </Typography>
          <TextField
            fullWidth
            multiline
            rows={12}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="템플릿 내용을 입력하세요. 변수는 {{변수명}} 형식으로 사용합니다."
            variant="outlined"
            sx={{
              '& .MuiOutlinedInput-root': {
                fontFamily: 'monospace',
                fontSize: '0.875rem',
              },
            }}
          />
        </Box>

        {/* Custom Variables Section */}
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
            커스텀 변수
          </Typography>

          {customVariables.length > 0 && (
            <Box sx={{ mb: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {customVariables.map((variable) => (
                <Chip
                  key={variable.key}
                  label={`${variable.label} (${variable.key})`}
                  onDelete={() => handleRemoveCustomVariable(variable.key)}
                  color="secondary"
                  variant="outlined"
                  sx={{
                    '& .MuiChip-label': {
                      fontSize: '0.875rem',
                    },
                  }}
                />
              ))}
            </Box>
          )}

           <Box
             sx={{
               p: 2,
               border: '1px solid',
               borderColor: 'divider',
               borderRadius: 1,
             }}
           >
            <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
              <TextField
                size="small"
                placeholder="변수 키 (예: user_name)"
                value={newVariable.key}
                onChange={(e) =>
                  setNewVariable({ ...newVariable, key: e.target.value })
                }
                sx={{ flex: 1 }}
              />
              <TextField
                size="small"
                placeholder="변수 레이블 (예: 사용자 이름)"
                value={newVariable.label}
                onChange={(e) =>
                  setNewVariable({ ...newVariable, label: e.target.value })
                }
                sx={{ flex: 1 }}
              />
              <Button
                variant="contained"
                size="small"
                startIcon={<Add />}
                onClick={handleAddCustomVariable}
              >
                추가
              </Button>
            </Stack>
             <Typography variant="caption" color="text.secondary">
               커스텀 변수를 추가하여 템플릿을 더 유연하게 만들 수 있습니다.
             </Typography>
           </Box>
        </Box>

        {/* Save Button */}
        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={!hasChanges || updateMutation.isPending}
            startIcon={updateMutation.isPending ? <CircularProgress size={20} /> : undefined}
          >
            {updateMutation.isPending ? '저장 중...' : '저장'}
          </Button>
        </Box>
      </Box>

      {/* Snackbar for feedback */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </>
  );
}
