'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getFeedbackList, getFeedbackStats, FeedbackItem } from '@/lib/api/admin';
import { useRouter } from 'next/navigation';

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
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">피드백 관리</h1>

        {statsLoading ? (
          <div className="grid grid-cols-3 gap-6 mb-8">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-lg shadow p-6 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-1/2 mb-4"></div>
                <div className="h-8 bg-gray-200 rounded w-1/3"></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-6 mb-8">
            <div className="bg-white rounded-lg shadow p-6">
              <p className="text-sm text-gray-600 mb-2">전체</p>
              <p className="text-3xl font-bold text-gray-900">{stats?.total || 0}</p>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <p className="text-sm text-gray-600 mb-2">긍정적</p>
              <p className="text-3xl font-bold text-green-600">{stats?.positive || 0}</p>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <p className="text-sm text-gray-600 mb-2">부정적</p>
              <p className="text-3xl font-bold text-red-600">{stats?.negative || 0}</p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg shadow">
          <div className="border-b border-gray-200">
            <div className="flex space-x-8 px-6">
              <button
                onClick={() => handleFilterChange('all')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  filterType === 'all'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                전체
              </button>
              <button
                onClick={() => handleFilterChange('positive')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  filterType === 'positive'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                긍정적
              </button>
              <button
                onClick={() => handleFilterChange('negative')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  filterType === 'negative'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                부정적
              </button>
            </div>
          </div>

          {feedbackLoading ? (
            <div className="p-6">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="border-b border-gray-200 py-4 animate-pulse">
                  <div className="grid grid-cols-4 gap-4">
                    <div className="h-4 bg-gray-200 rounded"></div>
                    <div className="h-4 bg-gray-200 rounded"></div>
                    <div className="h-4 bg-gray-200 rounded"></div>
                    <div className="h-4 bg-gray-200 rounded"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        날짜
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        사용자
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        유형
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        코멘트
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {feedbackData?.data.map((feedback: FeedbackItem) => (
                      <tr
                        key={feedback.id}
                        onClick={() => handleRowClick(feedback.id)}
                        className="hover:bg-gray-50 cursor-pointer transition-colors"
                      >
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {formatDate(feedback.createdAt)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {feedback.user.name || feedback.user.email || '익명'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <span className="text-2xl">
                            {feedback.type === 'positive' ? '👍' : '👎'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">
                          {truncateText(feedback.comment, 50)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {feedbackData && feedbackData.data.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-gray-500">피드백이 없습니다.</p>
                </div>
              )}

              {feedbackData && feedbackData.totalPages > 1 && (
                <div className="px-6 py-4 flex items-center justify-between border-t border-gray-200">
                  <div className="flex-1 flex justify-between sm:hidden">
                    <button
                      onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                      className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      이전
                    </button>
                    <button
                      onClick={() => setCurrentPage((prev) => Math.min(feedbackData.totalPages, prev + 1))}
                      disabled={currentPage === feedbackData.totalPages}
                      className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      다음
                    </button>
                  </div>
                  <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm text-gray-700">
                        전체 <span className="font-medium">{feedbackData.total}</span>개 중{' '}
                        <span className="font-medium">{(currentPage - 1) * limit + 1}</span>-
                        <span className="font-medium">
                          {Math.min(currentPage * limit, feedbackData.total)}
                        </span>{' '}
                        표시
                      </p>
                    </div>
                    <div>
                      <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                        <button
                          onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                          disabled={currentPage === 1}
                          className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          이전
                        </button>
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
                                <span key={`ellipsis-${page}`}>
                                  <span className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700">
                                    ...
                                  </span>
                                  <button
                                    onClick={() => setCurrentPage(page)}
                                    className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                                      currentPage === page
                                        ? 'z-10 bg-blue-50 border-blue-500 text-blue-600'
                                        : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                                    }`}
                                  >
                                    {page}
                                  </button>
                                </span>
                              );
                            }
                            return (
                              <button
                                key={page}
                                onClick={() => setCurrentPage(page)}
                                className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                                  currentPage === page
                                    ? 'z-10 bg-blue-50 border-blue-500 text-blue-600'
                                    : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                                }`}
                              >
                                {page}
                              </button>
                            );
                          })}
                        <button
                          onClick={() => setCurrentPage((prev) => Math.min(feedbackData.totalPages, prev + 1))}
                          disabled={currentPage === feedbackData.totalPages}
                          className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          다음
                        </button>
                      </nav>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
