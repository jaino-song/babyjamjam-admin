'use client';

import { use } from 'react';
import { Box, Typography, Button, CircularProgress } from '@mui/material';
import { ArrowBack } from '@mui/icons-material';
import { useRouter } from 'next/navigation';
import { useSystemTemplate } from '@/features/system-templates/hooks';
import { SystemTemplateEditor } from '@/features/system-templates/components/SystemTemplateEditor';
import { VersionHistory } from '@/features/system-templates/components/VersionHistory';

export default function EditSystemTemplatePage({ params }: { params: Promise<{ templateKey: string }> }) {
  const { templateKey } = use(params);
  const router = useRouter();
  const { data: template, isLoading } = useSystemTemplate(templateKey);

  if (isLoading) return <Box p={3}><CircularProgress /></Box>;
  if (!template) return <Box p={3}><Typography>템플릿을 찾을 수 없습니다.</Typography></Box>;

  return (
    <Box p={3}>
      <Button startIcon={<ArrowBack />} onClick={() => router.back()} sx={{ mb: 2 }}>
        뒤로
      </Button>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
        <Typography variant="h5">{template.name} 편집</Typography>
        <VersionHistory templateKey={template.templateKey} onRollback={() => router.refresh()} />
      </Box>
      <Typography variant="body2" color="text.secondary" mb={3}>
        {template.description}
      </Typography>
      <SystemTemplateEditor template={template} />
    </Box>
  );
}
