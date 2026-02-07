'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getFeedbackList, getFeedbackStats, FeedbackItem } from '@/lib/api/admin';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, ThumbsUp, ThumbsDown } from 'lucide-react';

type FilterType = 'all' | 'positive' | 'negative';

export default function AdminFeedbackPage() {
  const router = useRouter();
  const [currentPage, setCurrentPage] = useState(1);
  const [filterType, setFilterType] = useState<FilterType>('all');
  const limit = 20;

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['feedbackStats'],
    queryFn: getFeedbackStats,
  });

  const { data: feedbackData, isLoading: feedbackLoading } = useQuery({
    queryKey: ['feedbackList', currentPage, filterType],
    queryFn: () => getFeedbackList(
      currentPage,
      limit,
      filterType === 'all' ? undefined : filterType
    ),
  });

  const handleRowClick = (feedbackId: string) => {
    router.push(`/admin/feedback/${feedbackId}`);
  };

  const handleFilterChange = (type: FilterType) => {
    setFilterType(type);
    setCurrentPage(1);
  };

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

  return (
    <section data-component="admin" className="min-h-screen bg-background p-4 sm:p-6 md:p-8">
      <div data-component="admin-content" className="max-w-7xl mx-auto">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-6 sm:mb-8 opacity-0 animate-fade-in">
          피드백 관리
        </h1>

        {/* Stats Cards */}
        {statsLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="opacity-0 animate-fade-in" style={{ animationDelay: `${i * 100}ms` }}>
                <CardContent className="p-6">
                  <div className="h-4 bg-muted rounded w-1/2 mb-4 animate-pulse"></div>
                  <div className="h-8 bg-muted rounded w-1/3 animate-pulse"></div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div data-component="admin-stats" className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
            <Card className="opacity-0 animate-fade-in hover:shadow-md transition-shadow" style={{ animationDelay: '100ms' }}>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground mb-2">전체</p>
                <p className="text-3xl font-bold text-foreground">{stats?.total || 0}</p>
              </CardContent>
            </Card>
            <Card className="opacity-0 animate-fade-in hover:shadow-md transition-shadow" style={{ animationDelay: '200ms' }}>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground mb-2">긍정적</p>
                <p className="text-3xl font-bold text-success">{stats?.positive || 0}</p>
              </CardContent>
            </Card>
            <Card className="opacity-0 animate-fade-in hover:shadow-md transition-shadow" style={{ animationDelay: '300ms' }}>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground mb-2">부정적</p>
                <p className="text-3xl font-bold text-destructive">{stats?.negative || 0}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Feedback Table */}
        <Card data-component="admin-feedback-table" className="opacity-0 animate-fade-in" style={{ animationDelay: '400ms' }}>
          {/* Filter Tabs */}
          <div data-component="admin-feedback-filters" className="border-b border-border">
            <div className="flex space-x-8 px-6">
              {(['all', 'positive', 'negative'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => handleFilterChange(type)}
                  className={cn(
                    "py-4 px-1 border-b-2 font-medium text-sm transition-colors",
                    filterType === type
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                  )}
                >
                  {type === 'all' ? '전체' : type === 'positive' ? '긍정적' : '부정적'}
                </button>
              ))}
            </div>
          </div>

          {feedbackLoading ? (
            <div className="p-6">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="border-b border-border py-4">
                  <div className="grid grid-cols-4 gap-4">
                    <div className="h-4 bg-muted rounded animate-pulse"></div>
                    <div className="h-4 bg-muted rounded animate-pulse"></div>
                    <div className="h-4 bg-muted rounded animate-pulse"></div>
                    <div className="h-4 bg-muted rounded animate-pulse"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              <div data-component="admin-feedback-list" className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        날짜
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        사용자
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        유형
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        코멘트
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-background divide-y divide-border">
                    {feedbackData?.data.map((feedback: FeedbackItem, index: number) => (
                      <tr
                        key={feedback.id}
                        onClick={() => handleRowClick(feedback.id)}
                        className={cn(
                          "hover:bg-muted/50 cursor-pointer transition-colors",
                          "opacity-0 animate-fade-in"
                        )}
                        style={{ animationDelay: `${500 + index * 50}ms` }}
                      >
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                          {formatDate(feedback.createdAt)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                          {feedback.user.name || feedback.user.email || '익명'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          {feedback.type === 'positive' ? (
                            <ThumbsUp className="h-5 w-5 text-success" />
                          ) : (
                            <ThumbsDown className="h-5 w-5 text-destructive" />
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-foreground">
                          {truncateText(feedback.comment, 50)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {feedbackData && feedbackData.data.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-muted-foreground">피드백이 없습니다.</p>
                </div>
              )}

              {feedbackData && feedbackData.totalPages > 1 && (
                <div data-component="admin-feedback-pagination" className="px-6 py-4 flex items-center justify-between border-t border-border">
                  <div className="flex-1 flex justify-between sm:hidden">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                    >
                      이전
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage((prev) => Math.min(feedbackData.totalPages, prev + 1))}
                      disabled={currentPage === feedbackData.totalPages}
                    >
                      다음
                    </Button>
                  </div>
                  <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">
                        전체 <span className="font-medium text-foreground">{feedbackData.total}</span>개 중{' '}
                        <span className="font-medium text-foreground">{(currentPage - 1) * limit + 1}</span>-
                        <span className="font-medium text-foreground">
                          {Math.min(currentPage * limit, feedbackData.total)}
                        </span>{' '}
                        표시
                      </p>
                    </div>
                    <div>
                      <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                          disabled={currentPage === 1}
                          className="rounded-r-none"
                        >
                          <ChevronLeft className="h-4 w-4" />
                          <span className="sr-only">이전</span>
                        </Button>
                        {Array.from({ length: feedbackData.totalPages }, (_, i) => i + 1)
                          .filter((page) => {
                            return (
                              page === 1 ||
                              page === feedbackData.totalPages ||
                              (page >= currentPage - 2 && page <= currentPage + 2)
                            );
                          })
                          .map((page, index, array) => {
                            if (index > 0 && array[index - 1] !== page - 1) {
                              return (
                                <span key={`ellipsis-${page}`} className="flex">
                                  <span className="relative inline-flex items-center px-4 py-2 border border-border bg-background text-sm font-medium text-muted-foreground">
                                    ...
                                  </span>
                                  <Button
                                    variant={currentPage === page ? "default" : "outline"}
                                    size="sm"
                                    onClick={() => setCurrentPage(page)}
                                    className="rounded-none"
                                  >
                                    {page}
                                  </Button>
                                </span>
                              );
                            }
                            return (
                              <Button
                                key={page}
                                variant={currentPage === page ? "default" : "outline"}
                                size="sm"
                                onClick={() => setCurrentPage(page)}
                                className="rounded-none"
                              >
                                {page}
                              </Button>
                            );
                          })}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage((prev) => Math.min(feedbackData.totalPages, prev + 1))}
                          disabled={currentPage === feedbackData.totalPages}
                          className="rounded-l-none"
                        >
                          <ChevronRight className="h-4 w-4" />
                          <span className="sr-only">다음</span>
                        </Button>
                      </nav>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </section>
  );
}
