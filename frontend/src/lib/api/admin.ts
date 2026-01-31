import { api } from '@/app/lib/axios/client';

// Types matching backend DTOs
export interface FeedbackUser {
  id: string;
  name: string | null;
  email: string | null;
}

export interface FeedbackMessage {
  id: string;
  content: string;
  role: string;
  timestamp: string;
}

export interface FeedbackItem {
  id: string;
  type: 'positive' | 'negative';
  comment: string | null;
  createdAt: string;
  user: FeedbackUser;
  message: FeedbackMessage;
}

export interface PaginatedFeedback {
  data: FeedbackItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface FeedbackStats {
  positive: number;
  negative: number;
  total: number;
}

export async function getFeedbackList(
  page = 1,
  limit = 20,
  type?: 'positive' | 'negative'
): Promise<PaginatedFeedback> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (type) params.append('type', type);
  const { data } = await api.get(`/admin/feedback?${params}`);
  return data;
}

export async function getFeedbackStats(): Promise<FeedbackStats> {
  const { data } = await api.get('/admin/feedback/stats');
  return data;
}

// Feedback detail types
export interface SessionMessage {
  id: string;
  role: string;
  content: string;
  timestamp: string;
}

export interface FeedbackSession {
  id: string;
  messages: SessionMessage[];
}

export interface FeedbackDetail {
  id: string;
  type: 'positive' | 'negative';
  comment: string | null;
  createdAt: string;
  user: FeedbackUser;
  message: FeedbackMessage;
  session: FeedbackSession;
}

export async function getFeedbackDetail(id: string): Promise<FeedbackDetail> {
  const { data } = await api.get(`/admin/feedback/${id}`);
  return data;
}
