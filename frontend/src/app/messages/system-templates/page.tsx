"use client";

import { useState } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Skeleton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Chip,
  Divider,
} from '@mui/material';
import { useRouter } from 'next/navigation';
import { useSystemTemplates } from '@/features/system-templates/hooks';
import type { SystemTemplate } from '@/features/system-templates/types';

export default function SystemTemplatesPage() {
  const router = useRouter();
  const { data: templates, isLoading } = useSystemTemplates();
  const [selectedTemplate, setSelectedTemplate] = useState<SystemTemplate | null>(null);

  const handleRowClick = (template: SystemTemplate) => {
    setSelectedTemplate(template);
  };

  const handleCloseModal = () => {
    setSelectedTemplate(null);
  };

  const handleEdit = () => {
    if (selectedTemplate) {
      router.push(`/messages/system-templates/${selectedTemplate.templateKey}`);
    }
  };

  if (isLoading) {
    return (
      <Box p={3}>
        <Typography variant="h5" mb={3}>시스템 템플릿 관리</Typography>
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>템플릿 이름</TableCell>
                <TableCell>설명</TableCell>
                <TableCell>마지막 수정</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton width={120} /></TableCell>
                  <TableCell><Skeleton width={200} /></TableCell>
                  <TableCell><Skeleton width={100} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    );
  }

  return (
    <Box p={3}>
      <Typography variant="h5" mb={3}>시스템 템플릿 관리</Typography>
      <Typography variant="body2" color="text.secondary" mb={3}>
        고정된 메시지 템플릿의 내용을 수정할 수 있습니다. 행을 클릭하면 상세 정보를 볼 수 있습니다.
      </Typography>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>템플릿 이름</TableCell>
              <TableCell>설명</TableCell>
              <TableCell>마지막 수정</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {templates?.map((template) => (
              <TableRow
                key={template.templateKey}
                hover
                onClick={() => handleRowClick(template)}
                sx={{ cursor: 'pointer' }}
              >
                <TableCell>
                  <Typography fontWeight={500}>{template.name}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary">
                    {template.description}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary">
                    {new Date(template.updatedAt).toLocaleDateString('ko-KR')}
                  </Typography>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Template Detail Modal */}
      <Dialog
        open={!!selectedTemplate}
        onClose={handleCloseModal}
        maxWidth="md"
        fullWidth
      >
        {selectedTemplate && (
          <>
            <DialogTitle component="div">
              <Typography variant="h6" component="span" sx={{ display: 'block' }}>
                {selectedTemplate.name}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {selectedTemplate.description}
              </Typography>
            </DialogTitle>
            <DialogContent dividers>
              {/* Message Template Content */}
              <Box mb={3}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  메시지 템플릿
                </Typography>
                <Paper
                  variant="outlined"
                  sx={{
                    p: 2,
                    bgcolor: 'grey.50',
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'monospace',
                    fontSize: '0.875rem',
                  }}
                >
                  {selectedTemplate.content}
                </Paper>
              </Box>

              <Divider sx={{ my: 2 }} />

               {/* Variables Used */}
               <Box>
                 <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                   사용된 변수 ({selectedTemplate.requiredVariables?.length ?? 0}개)
                 </Typography>
                 {(selectedTemplate.requiredVariables?.length ?? 0) > 0 ? (
                   <Box display="flex" flexWrap="wrap" gap={1}>
                     {selectedTemplate.requiredVariables?.map((variable) => (
                      <Chip
                        key={variable.key}
                        label={`{{${variable.key}}} - ${variable.label}`}
                        size="small"
                        variant="outlined"
                        color="primary"
                      />
                    ))}
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    이 템플릿은 변수를 사용하지 않습니다.
                  </Typography>
                )}
              </Box>
            </DialogContent>
            <DialogActions>
              <Button onClick={handleCloseModal}>닫기</Button>
              <Button variant="contained" onClick={handleEdit}>
                편집하기
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}
