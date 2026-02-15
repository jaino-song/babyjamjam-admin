'use client';

import { use } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSystemTemplate } from '@/features/system-templates/hooks';
import { SystemTemplateEditor } from '@/features/system-templates/components/system-template-editor';
import { VersionHistory } from '@/features/system-templates/components/VersionHistory';
import { ContentPaper } from '@/components/app/root/content-paper';

export default function EditSystemTemplatePage({ params }: { params: Promise<{ templateKey: string }> }) {
  const { templateKey } = use(params);
  const router = useRouter();
  const { data: template, isLoading } = useSystemTemplate(templateKey);

  if (isLoading) {
    return (
      <div data-component="messages-system-template-detail" className="bg-background">
        <section data-component="messages-system-template-detail-content" className="px-4 sm:px-6 md:px-12 py-6 sm:py-8 mx-auto">
          <ContentPaper className="min-h-[70vh] flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </ContentPaper>
        </section>
      </div>
    );
  }

  if (!template) {
    return (
      <div data-component="messages-system-template-detail" className="bg-background">
        <section data-component="messages-system-template-detail-content" className="px-4 sm:px-6 md:px-12 py-6 sm:py-8 mx-auto">
          <ContentPaper title="오류" className="min-h-[70vh]">
            <p className="text-muted-foreground">템플릿을 찾을 수 없습니다.</p>
          </ContentPaper>
        </section>
      </div>
    );
  }

  const customHeader = (
    <div data-component="messages-system-template-detail-header" className="mb-6">
      <div className="flex items-center gap-3 mb-2">
        <h2 className="text-xl font-bold text-primary">
          {template.name}
        </h2>
        <Badge>시스템</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        {template.description}
      </p>
    </div>
  );

  return (
    <div data-component="messages-system-template-detail" className="bg-background">
      <section data-component="messages-system-template-detail-content" className="px-4 sm:px-6 md:px-12 py-6 sm:py-8 mx-auto">
        <ContentPaper
          header={customHeader}
          className="min-h-[70vh]"
        >
          <div data-component="messages-system-template-detail-actions" className="flex justify-between items-center mb-6">
            <Button variant="ghost" onClick={() => router.back()}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              뒤로
            </Button>
            <VersionHistory templateKey={template.templateKey} onRollback={() => router.refresh()} />
          </div>
          <SystemTemplateEditor template={template} />
        </ContentPaper>
      </section>
    </div>
  );
}
