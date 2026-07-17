'use client';

import { use } from 'react';
import { ArrowLeft, Loader2, Monitor, Send, Workflow } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSystemTemplate } from '@/features/system-templates/hooks';
import { ContentPaper } from '@/components/app/root/content-paper';

export default function EditSystemTemplatePage({ params }: { params: Promise<{ templateKey: string }> }) {
  const { templateKey } = use(params);
  const router = useRouter();
  const { data: template, isLoading } = useSystemTemplate(templateKey);

  if (isLoading) {
    return (
      <div data-component="messages-system-template-detail" className="bg-background">
        <section
          data-component="messages-system-template-detail-content"
          className="mx-auto px-4 py-6 sm:px-6 sm:py-8 md:px-12"
        >
          <ContentPaper className="flex min-h-[70vh] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </ContentPaper>
        </section>
      </div>
    );
  }

  if (!template) {
    return (
      <div data-component="messages-system-template-detail" className="bg-background">
        <section
          data-component="messages-system-template-detail-content"
          className="mx-auto px-4 py-6 sm:px-6 sm:py-8 md:px-12"
        >
          <ContentPaper title="오류" className="min-h-[70vh]">
            <p className="text-muted-foreground">템플릿을 찾을 수 없습니다.</p>
          </ContentPaper>
        </section>
      </div>
    );
  }

  const customHeader = (
    <div data-component="messages-system-template-detail-header" className="mb-6">
      <div className="mb-2 flex items-center gap-3">
        <h2 className="text-xl font-bold text-primary">{template.name}</h2>
        <Badge>시스템</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{template.description}</p>
    </div>
  );

  const handleSend = () => {
    const params = new URLSearchParams({ body: template.content });
    router.push(`/messages/new?${params.toString()}`);
  };

  return (
    <div data-component="messages-system-template-detail" className="bg-background">
      <section
        data-component="messages-system-template-detail-content"
        className="mx-auto px-4 py-6 sm:px-6 md:px-12 sm:py-8"
      >
        <ContentPaper header={customHeader} className="min-h-[70vh]">
          <div data-component="messages-system-template-detail-actions" className="mb-6 flex items-center">
            <Button variant="ghost" onClick={() => router.back()}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              뒤로
            </Button>
          </div>

          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-[0.78rem] font-semibold text-v3-dark">본문</p>
              <div
                data-component="messages-system-template-content"
                className="whitespace-pre-wrap rounded-2xl border border-v3-border/60 bg-white p-4 text-[0.85rem] leading-relaxed text-v3-dark"
              >
                {template.content}
              </div>
            </div>

            {template.requiredVariables && template.requiredVariables.length > 0 ? (
              <div>
                <p className="mb-1.5 text-[0.78rem] font-semibold text-v3-dark">필수 변수</p>
                <div className="flex flex-wrap gap-2">
                  {template.requiredVariables.map((v) => (
                    <span
                      key={v.key}
                      className="rounded-full bg-v3-dim-white px-2.5 py-1 text-[0.7rem] text-v3-text-muted"
                      title={v.description}
                    >
                      <code className="font-mono text-[0.7rem]">#&#123;{v.key}&#125;</code>
                      <span className="ml-1">· {v.label}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <Button
              data-component="messages-system-template-send-cta"
              className="w-full gap-2"
              onClick={handleSend}
            >
              <Send className="h-4 w-4" />이 템플릿으로 보내기
            </Button>

            <div
              data-component="messages-system-template-desktop-only"
              className="flex items-start gap-3 rounded-2xl border border-dashed border-v3-border bg-v3-dim-white px-4 py-3"
            >
              <Monitor className="mt-0.5 h-5 w-5 shrink-0 text-v3-primary" />
              <p className="text-[0.78rem] leading-relaxed text-v3-text-muted">
                <span className="font-semibold text-v3-dark">시스템 템플릿 본문 편집·버전 롤백은 데스크톱에서만 가능합니다.</span>
                <br />
                내용 변경이 필요하면 데스크톱에서 열어 주세요.
              </p>
            </div>

            <Link
              href="/messages/automation"
              data-component="messages-system-template-trigger-link"
              className="flex items-start gap-3 rounded-2xl border border-v3-border/60 bg-white px-4 py-3 hover:bg-v3-dim-white"
            >
              <Workflow className="mt-0.5 h-5 w-5 shrink-0 text-v3-primary" />
              <div className="flex-1">
                <p className="text-[0.85rem] font-semibold text-v3-dark">자동 발송 규칙 설정</p>
                <p className="text-[0.72rem] text-v3-text-muted">
                  이 템플릿의 자동 발송 ON/OFF·발송 시점은 메시지 → 자동 전송에서 관리합니다.
                </p>
              </div>
            </Link>
          </div>
        </ContentPaper>
      </section>
    </div>
  );
}
