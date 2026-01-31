export interface FeedbackUserDto {
  id: string;
  name: string | null;
  email: string | null;
}

export interface FeedbackMessageDto {
  id: string;
  content: string;
  role: string;
  timestamp: Date;
}

export interface FeedbackItemDto {
  id: string;
  type: 'positive' | 'negative';
  comment: string | null;
  createdAt: Date;
  user: FeedbackUserDto;
  message: FeedbackMessageDto;
}

export interface PaginatedFeedbackDto {
  data: FeedbackItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface FeedbackStatsDto {
  positive: number;
  negative: number;
  total: number;
}

export interface SessionMessageDto {
  id: string;
  role: string;
  content: string;
  timestamp: Date;
}

export interface FeedbackSessionDto {
  id: string;
  messages: SessionMessageDto[];
}

export interface FeedbackDetailDto {
  id: string;
  type: 'positive' | 'negative';
  comment: string | null;
  createdAt: Date;
  user: FeedbackUserDto;
  message: FeedbackMessageDto;
  session: FeedbackSessionDto;
}
