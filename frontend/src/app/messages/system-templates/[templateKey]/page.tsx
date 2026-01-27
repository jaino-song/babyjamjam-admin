'use client';

import { use } from 'react';
import { Box, Button, CircularProgress, Typography, Chip } from '@mui/material';
import { ArrowBack } from '@mui/icons-material';
import { useRouter } from 'next/navigation';
import { useSystemTemplate } from '@/features/system-templates/hooks';
import { SystemTemplateEditor } from '@/features/system-templates/components/system-template-editor';
import { VersionHistory } from '@/features/system-templates/components/VersionHistory';
import { ContentPaper } from '@/app/(components)/root/content-paper';

export default function EditSystemTemplatePage({ params }: { params: Promise<{ templateKey: string }> }) {
  const { templateKey } = use(params);
  const router = useRouter();
  const { data: template, isLoading } = useSystemTemplate(templateKey);

  if (isLoading) {
    return (
      <Box sx={{ bgcolor: "background.paper" }}>
        <Box
          component="section"
          sx={{
            px: { xs: 2, sm: 3, md: 6 },
            py: { xs: 3, sm: 4 },
            mx: "auto",
          }}
        >
          <ContentPaper sx={{ minHeight: "70vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <CircularProgress />
          </ContentPaper>
        </Box>
      </Box>
    );
  }

  if (!template) {
    return (
      <Box sx={{ bgcolor: "background.paper" }}>
        <Box
          component="section"
          sx={{
            px: { xs: 2, sm: 3, md: 6 },
            py: { xs: 3, sm: 4 },
            mx: "auto",
          }}
        >
          <ContentPaper title="오류" sx={{ minHeight: "70vh" }}>
            <Typography>템플릿을 찾을 수 없습니다.</Typography>
          </ContentPaper>
        </Box>
      </Box>
    );
  }

  const customHeader = (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 1 }}>
        <Typography
          variant="h5"
          color="primary.main"
          fontWeight={700}
        >
          {template.name}
        </Typography>
        <Chip 
          label="시스템" 
          color="primary" 
          size="small"
        />
      </Box>
      <Typography variant="body2" color="text.secondary">
        {template.description}
      </Typography>
    </Box>
  );

  return (
    <Box sx={{ bgcolor: "background.paper" }}>
      <Box
        component="section"
        sx={{
          px: { xs: 2, sm: 3, md: 6 },
          py: { xs: 3, sm: 4 },
          mx: "auto",
        }}
      >
        <ContentPaper
          header={customHeader}
          sx={{ minHeight: "70vh" }}
        >
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
            <Button startIcon={<ArrowBack />} onClick={() => router.back()}>
              뒤로
            </Button>
            <VersionHistory templateKey={template.templateKey} onRollback={() => router.refresh()} />
          </Box>
          <SystemTemplateEditor template={template} />
        </ContentPaper>
      </Box>
    </Box>
  );
}
