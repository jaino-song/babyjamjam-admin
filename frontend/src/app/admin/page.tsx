'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getFeedbackList, getFeedbackStats, getFeedbackDetail, FeedbackItem, SessionMessage } from '@/lib/api/admin';
import { cn } from '@/lib/utils';
import { MessageSquare, ThumbsUp, ThumbsDown } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { StatsBar, SplitLayout, ListPanel, DetailPanel, InfoCard, InfoRow, AnimatedSlotList, EmptyState, PageSection, DetailSkeleton, ListEmptyState } from '@/components/app/v3';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type FilterType = 'all' | 'positive' | 'negative';

const filterItems = [
  { label: '전체', value: 'all' },
  { label: '긍정적', value: 'positive' },
  { label: '부정적', value: 'negative' },
];

export default function AdminFeedbackPage() {
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [selectedFeedbackId, setSelectedFeedbackId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['feedbackStats'],
    queryFn: getFeedbackStats,
  });

  const { data: feedbackData, isLoading: feedbackLoading, error } = useQuery({
    queryKey: ['feedbackList', 1, filterType],
    queryFn: () => getFeedbackList(1, 100, filterType === 'all' ? undefined : filterType),
  });

  const feedbackList = feedbackData?.data ?? [];

  const filteredList = useMemo(() => {
    if (!searchQuery.trim()) return feedbackList;
    const q = searchQuery.trim().toLowerCase();
    return feedbackList.filter(f =>
      (f.user.name?.toLowerCase().includes(q)) ||
      (f.user.email?.toLowerCase().includes(q)) ||
      (f.comment?.toLowerCase().includes(q))
    );
  }, [feedbackList, searchQuery]);

  const selectedFeedback = useMemo(() => {
    if (!selectedFeedbackId) return null;
    return filteredList.find(f => f.id === selectedFeedbackId) ?? null;
  }, [selectedFeedbackId, filteredList]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const truncateText = (text: string | null, maxLength: number) => {
    if (!text) return '-';
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  };

  if (error) {
    return (
      <div className="p-6">
        <div data-component="admin-error" className="bg-v3-burgundy-light text-v3-burgundy rounded-[18px] p-6 text-center">
          피드백을 불러오는데 실패했습니다.
        </div>
      </div>
    );
  }

  return (
    <PageSection name="admin">
      <StatsBar
        name="admin"
        isLoading={statsLoading}
        items={[
          { icon: MessageSquare, value: stats?.total || 0, label: '전체', counter: '건' },
          { icon: ThumbsUp, value: stats?.positive || 0, label: '긍정적', counter: '건', colorIndex: 1 },
          { icon: ThumbsDown, value: stats?.negative || 0, label: '부정적', counter: '건', colorIndex: 2 },
        ]}
      />

      <SplitLayout>
        <ListPanel
          title="피드백 목록"
          tabs={filterItems}
          activeTab={filterType}
          onTabChange={(v) => { setFilterType(v as FilterType); setSelectedFeedbackId(null); }}
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="사용자, 코멘트 검색..."
        >
          {!feedbackLoading && filteredList.length === 0 ? (
            <ListEmptyState message={searchQuery ? '검색 결과가 없습니다' : '피드백이 없습니다'} />
          ) : (
            <AnimatedSlotList<FeedbackItem>
              items={filteredList}
              isLoading={feedbackLoading}
              loadingCount={5}
              className="space-y-2"
              slotClassName={({ item, isLoading: slotLoading }) => {
                const isActive = !slotLoading && item && selectedFeedback?.id === item.id;
                return cn(
                  'flex items-center gap-3 p-3 rounded-[14px] transition-all duration-200 bg-white border-2 border-transparent',
                  !slotLoading && 'cursor-pointer',
                  isActive
                    ? 'bg-v3-primary-light border-2 border-v3-primary'
                    : !slotLoading && 'hover:bg-v3-primary-light/50 hover:border-v3-primary/30'
                );
              }}
              onSlotClick={(feedback) => setSelectedFeedbackId(feedback.id)}
              render={({ item: feedback, isLoading: slotLoading }) => {
                if (slotLoading) {
                  return (
                    <>
                      <div className="w-9 h-9 rounded-[10px] shrink-0 bg-v3-dim-white flex items-center justify-center">
                        <Skeleton className="w-4 h-4 rounded-md bg-white/70" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <Skeleton className="h-4 w-24 mb-1.5 bg-v3-dim-white" />
                        <Skeleton className="h-3 w-32 bg-v3-dim-white" />
                      </div>
                      <Skeleton className="h-3 w-12 bg-v3-dim-white shrink-0" />
                    </>
                  );
                }
                if (!feedback) return null;
                return (
                  <>
                    <div className={cn(
                      'w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0',
                      feedback.type === 'positive' ? 'bg-emerald-50' : 'bg-red-50'
                    )}>
                      {feedback.type === 'positive'
                        ? <ThumbsUp className="w-4 h-4 text-emerald-500" />
                        : <ThumbsDown className="w-4 h-4 text-red-500" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[0.8rem] font-semibold text-v3-dark truncate">
                        {feedback.user.name || feedback.user.email || '익명'}
                      </p>
                      <p className="text-[0.7rem] text-v3-text-muted truncate">
                        {truncateText(feedback.comment, 30)}
                      </p>
                    </div>
                    <span className="text-[0.65rem] text-v3-text-muted whitespace-nowrap">
                      {formatDate(feedback.createdAt)}
                    </span>
                  </>
                );
              }}
            />
          )}
        </ListPanel>

        {feedbackLoading ? (
          <DetailSkeleton
            name="admin-detail-skeleton"
            headerActions={0}
            sections={[
              { titleWidth: 'w-16', rows: ['w-1/2', 'w-2/3', 'w-1/3', 'w-1/2'] },
              { titleWidth: 'w-20', rows: ['w-3/4', 'w-full', 'w-2/3'] },
            ]}
          />
        ) : selectedFeedback ? (
          <FeedbackDetail feedback={selectedFeedback} formatDate={formatDate} />
        ) : (
          <EmptyState name="admin-empty" icon={MessageSquare} message="피드백을 선택하면 상세 정보가 표시됩니다" />
        )}
      </SplitLayout>
    </PageSection>
  );
}

function FeedbackDetail({ feedback, formatDate }: { feedback: FeedbackItem; formatDate: (d: string) => string }) {
  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['feedbackDetail', feedback.id],
    queryFn: () => getFeedbackDetail(feedback.id),
  });

  return (
    <DetailPanel
      title={feedback.type === 'positive' ? '긍정적 피드백' : '부정적 피드백'}
      badges={
        <span className={cn(
          'inline-flex items-center rounded-[50px] px-3 py-1 text-[0.65rem] font-semibold',
          feedback.type === 'positive'
            ? 'bg-emerald-50 text-emerald-600'
            : 'bg-red-50 text-red-600'
        )}>
          {feedback.type === 'positive' ? '👍 긍정적' : '👎 부정적'}
        </span>
      }
      subtitle={<>작성일: {formatDate(feedback.createdAt)}</>}
    >
      <div className="space-y-5">
        <InfoCard title="피드백 정보">
          <InfoRow label="유형" value={feedback.type === 'positive' ? '긍정적' : '부정적'} />
          <InfoRow label="사용자" value={feedback.user.name || feedback.user.email || '익명'} />
          <InfoRow label="날짜" value={formatDate(feedback.createdAt)} />
          <InfoRow label="코멘트" value={feedback.comment || '-'} />
        </InfoCard>

        {detailLoading ? (
          <InfoCard title="대화 내역">
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-3 w-20 bg-v3-dim-white" />
                  <Skeleton className="h-12 w-full bg-v3-dim-white rounded-[14px]" />
                </div>
              ))}
            </div>
          </InfoCard>
        ) : detail?.session?.messages && detail.session.messages.length > 0 ? (
          <InfoCard title="대화 내역">
            <div className="space-y-3">
              {detail.session.messages.map((message: SessionMessage) => {
                const isHighlighted = message.id === detail.message.id;
                const isUser = message.role === 'user';

                return (
                  <div
                    key={message.id}
                    className={cn(
                      'rounded-[14px] p-3 text-[0.8rem]',
                      isHighlighted
                        ? 'ring-2 ring-amber-400 bg-amber-50'
                        : isUser
                          ? 'bg-v3-primary-light'
                          : 'bg-v3-dim-white'
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={cn(
                        'text-[0.7rem] font-semibold',
                        isHighlighted ? 'text-amber-600' : isUser ? 'text-v3-primary' : 'text-v3-text-muted'
                      )}>
                        {isUser ? '사용자' : 'AI 어시스턴트'}
                      </span>
                      <span className="text-[0.65rem] text-v3-text-muted">
                        {formatDate(message.timestamp)}
                      </span>
                      {isHighlighted && (
                        <span className="text-[0.65rem] font-bold text-amber-500 ml-auto">⭐ 피드백 대상</span>
                      )}
                    </div>
                    {isUser ? (
                      <p className="text-v3-text whitespace-pre-wrap break-words">{message.content}</p>
                    ) : (
                      <div className="prose prose-sm max-w-none text-v3-text">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed text-[0.8rem]">{children}</p>,
                            ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-1 text-[0.8rem]">{children}</ul>,
                            ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-1 text-[0.8rem]">{children}</ol>,
                            li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                            code: ({ className, children }) => {
                              const isInline = !className;
                              return isInline ? (
                                <code className="bg-white/60 text-v3-dark px-1 py-0.5 rounded text-[0.75rem] font-mono">{children}</code>
                              ) : (
                                <code className={className}>{children}</code>
                              );
                            },
                            pre: ({ children }) => <pre className="bg-v3-dark text-white p-3 rounded-[10px] overflow-x-auto mb-2 text-[0.75rem]">{children}</pre>,
                          }}
                        >
                          {message.content}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </InfoCard>
        ) : null}
      </div>
    </DetailPanel>
  );
}
