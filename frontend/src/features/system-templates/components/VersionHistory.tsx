'use client';

import { useState } from 'react';
import {
  Box,
  Drawer,
  Button,
  List,
  IconButton,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  CircularProgress,
  Paper,
} from '@mui/material';
import { History, Visibility, Restore, RestartAlt } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';

import { systemTemplateService } from '@/services/system-template.service';
import {
  systemTemplateKeys,
  useTemplateVersions,
  useRollbackTemplate,
  useResetTemplate,
} from '../hooks';
import type { VersionDetail, VersionHistoryItem } from '../types';

interface Props {
  templateKey: string;
  onRollback?: () => void;
}

export function VersionHistory({ templateKey, onRollback }: Props) {
  const [open, setOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<
    { type: 'rollback' | 'reset'; version?: number } | null
  >(null);
  const [previewVersion, setPreviewVersion] = useState<VersionHistoryItem | null>(null);

  const { data: versions, isLoading } = useTemplateVersions(templateKey);
  const rollbackMutation = useRollbackTemplate();
  const resetMutation = useResetTemplate();

  const { data: previewDetail, isLoading: isPreviewLoading } = useQuery<VersionDetail>({
    queryKey:
      previewVersion && templateKey
        ? systemTemplateKeys.versionDetail(templateKey, previewVersion.versionNumber)
        : ['system-templates', 'version-detail', templateKey, 'disabled'],
    queryFn: async () => {
      if (!previewVersion) {
        throw new Error('previewVersion is required');
      }

      const response = await systemTemplateService.getVersionContent(
        templateKey,
        previewVersion.versionNumber,
      );
      return response.data;
    },
    enabled: !!previewVersion && !!templateKey,
  });

  const handleRollback = async (versionNumber: number) => {
    await rollbackMutation.mutateAsync({ key: templateKey, versionNumber });
    setConfirmDialog(null);
    setOpen(false);
    onRollback?.();
  };

  const handleReset = async () => {
    await resetMutation.mutateAsync(templateKey);
    setConfirmDialog(null);
    setOpen(false);
    onRollback?.();
  };

  return (
    <>
      <Button startIcon={<History />} variant="outlined" onClick={() => setOpen(true)}>
        버전 기록
      </Button>

      <Drawer anchor="right" open={open} onClose={() => setOpen(false)}>
        <Box sx={{ width: 350, p: 2 }}>
          <Typography variant="h6" mb={2}>
            버전 기록
          </Typography>

          {isLoading ? (
            <CircularProgress />
          ) : (
            <List disablePadding sx={{ p: 0, listStyle: 'none' }}>
              {versions?.map((version) => (
                <Box
                  key={version.versionNumber}
                  component="li"
                  sx={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 1,
                    py: 1,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    '&:last-of-type': { borderBottom: 'none' },
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="subtitle2">{`버전 ${version.versionNumber}`}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {new Date(version.createdAt).toLocaleString('ko-KR')}
                      {version.createdBy && ` · ${version.createdBy}`}
                    </Typography>
                  </Box>

                  <Box sx={{ flexShrink: 0, display: 'flex', gap: 0.5 }}>
                    <IconButton
                      size="small"
                      onClick={() => setPreviewVersion(version)}
                      title="미리보기"
                    >
                      <Visibility fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() =>
                        setConfirmDialog({ type: 'rollback', version: version.versionNumber })
                      }
                      title="이 버전으로 복원"
                    >
                      <Restore fontSize="small" />
                    </IconButton>
                  </Box>
                </Box>
              ))}
            </List>
          )}

          <Divider sx={{ my: 2 }} />

          <Button
            fullWidth
            variant="outlined"
            color="warning"
            startIcon={<RestartAlt />}
            onClick={() => setConfirmDialog({ type: 'reset' })}
          >
            기본값으로 초기화
          </Button>
        </Box>
      </Drawer>

      <Dialog open={!!previewVersion} onClose={() => setPreviewVersion(null)} fullWidth maxWidth="sm">
        <DialogTitle>
          {previewVersion ? `버전 ${previewVersion.versionNumber} 미리보기` : '버전 미리보기'}
        </DialogTitle>
        <DialogContent dividers>
          {isPreviewLoading ? (
            <Box display="flex" justifyContent="center" py={3}>
              <CircularProgress />
            </Box>
          ) : (
            <>
              {previewVersion && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {new Date(previewVersion.createdAt).toLocaleString('ko-KR')}
                  {previewVersion.createdBy && ` · ${previewVersion.createdBy}`}
                </Typography>
              )}
              <Paper
                sx={{
                  p: 2,
                  bgcolor: 'grey.50',
                  maxHeight: 420,
                  overflow: 'auto',
                }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'inherit',
                    lineHeight: 1.6,
                  }}
                >
                  {previewDetail?.content ?? ''}
                </Typography>
              </Paper>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreviewVersion(null)}>닫기</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!confirmDialog} onClose={() => setConfirmDialog(null)}>
        <DialogTitle>
          {confirmDialog?.type === 'rollback' ? '버전 복원' : '기본값 초기화'}
        </DialogTitle>
        <DialogContent>
          {confirmDialog?.type === 'rollback'
            ? `버전 ${confirmDialog.version}으로 복원하시겠습니까? 현재 내용은 새 버전으로 저장됩니다.`
            : '기본값으로 초기화하시겠습니까? 현재 내용은 새 버전으로 저장됩니다.'}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog(null)}>취소</Button>
          <Button
            variant="contained"
            color={confirmDialog?.type === 'reset' ? 'warning' : 'primary'}
            onClick={() =>
              confirmDialog?.type === 'rollback'
                ? handleRollback(confirmDialog.version!)
                : handleReset()
            }
          >
            {confirmDialog?.type === 'rollback' ? '복원' : '초기화'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
