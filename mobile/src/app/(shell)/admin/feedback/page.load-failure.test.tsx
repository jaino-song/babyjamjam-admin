import { fireEvent, render, screen, within } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import AdminFeedbackPage from './page';

jest.mock('@tanstack/react-query', () => ({ useQuery: jest.fn() }));

const refetch = jest.fn();
const success = { isLoading: false, isPaused: false, isError: false, isFetching: false, status: 'success', fetchStatus: 'idle', refetch };
const empty = { data: [], total: 0 };
const row = { id: 'feedback-1', type: 'positive', comment: 'cached comment', createdAt: '2026-09-18', user: { name: 'Cached user', email: 'qa@example.com' } };
let list: Record<string, unknown>;
let stats: Record<string, unknown>;

beforeEach(() => {
  refetch.mockReset();
  list = { ...success, data: empty };
  stats = { ...success, data: { total: 0, positive: 0, negative: 0 } };
  (useQuery as jest.Mock).mockImplementation(({ queryKey }) => queryKey[0] === 'feedbackStats' ? stats : list);
});

it('keeps the shell and retries a failed list without claiming empty', () => {
  list = { ...success, data: undefined, isError: true, status: 'error', error: new Error('network') };
  render(<AdminFeedbackPage />);
  expect(screen.getByText('피드백 목록')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('사용자, 코멘트 검색...')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('피드백을 불러오지 못했습니다');
  expect(screen.queryByText('피드백이 없습니다')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  expect(refetch).toHaveBeenCalledTimes(1);
});

it.each(['loading', 'paused'])('shows skeletons rather than empty or zero while %s', (state) => {
  list = stats = { ...success, data: undefined, isPending: true, isLoading: state === 'loading', isPaused: state === 'paused', isFetching: state === 'loading', status: 'pending', fetchStatus: state === 'paused' ? 'paused' : 'fetching' };
  const { container } = render(<AdminFeedbackPage />);
  expect(container.querySelector('[data-component$="skeleton-content"]')).toBeInTheDocument();
  expect(container.querySelectorAll('[data-component="mobile_admin_feedback_stats"] [data-slot="skeleton"]')).toHaveLength(9);
  expect(screen.queryByText('피드백이 없습니다')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByText('0')).not.toBeInTheDocument();
});

it('shows real zero and empty only after success, including search empty', () => {
  render(<AdminFeedbackPage />);
  expect(screen.getByText('피드백이 없습니다')).toBeInTheDocument();
  expect(screen.getAllByText('0')).toHaveLength(3);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText('사용자, 코멘트 검색...'), { target: { value: 'missing' } });
  expect(screen.getByText('검색 결과가 없습니다')).toBeInTheDocument();
});

it('shows unknown failed stats without counters', () => {
  stats = { ...success, data: undefined, isError: true, status: 'error' };
  const { container } = render(<AdminFeedbackPage />);
  const bar = container.querySelector('[data-component="mobile_admin_feedback_stats"]') as HTMLElement;
  expect(within(bar).getAllByText('—')).toHaveLength(3);
  expect(within(bar).queryByText('건')).not.toBeInTheDocument();
  expect(within(bar).queryByText('0')).not.toBeInTheDocument();
});

it.each([false, true])('keeps cached list (empty=%s) and one inline retry notice', (isEmpty) => {
  list = { ...success, data: isEmpty ? empty : { data: [row] }, isError: true, status: 'error' };
  const { rerender } = render(<AdminFeedbackPage />);
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.getByRole('alert')).toHaveAttribute('data-size', 'inline');
  expect(screen.getByRole('alert')).toHaveTextContent('최신 정보를 불러오지 못했습니다');
  expect(screen.getByText(isEmpty ? '피드백이 없습니다' : 'Cached user')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  expect(refetch).toHaveBeenCalledTimes(1);
  list = { ...list, isFetching: true, fetchStatus: 'fetching' };
  rerender(<AdminFeedbackPage />);
  expect(screen.getByRole('button', { name: '다시 시도' })).toBeDisabled();
});

it('does not turn a cached paused refetch into loading', () => {
  list = { ...success, data: { data: [row] }, isPaused: true, fetchStatus: 'paused' };
  stats = { ...success, data: { total: 7, positive: 7, negative: 0 }, isPaused: true, fetchStatus: 'paused' };
  render(<AdminFeedbackPage />);
  expect(screen.getByText('Cached user')).toBeInTheDocument();
  expect(screen.getAllByText('7')).toHaveLength(2);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('treats each selected tab as its own paused or failed query', () => {
  (useQuery as jest.Mock).mockImplementation(({ queryKey }) => {
    if (queryKey[0] === 'feedbackStats') return stats;
    if (queryKey[2] === 'positive') return { ...success, data: undefined, isPending: true, isPaused: true, status: 'pending', fetchStatus: 'paused' };
    if (queryKey[2] === 'negative') return { ...success, data: undefined, isError: true, status: 'error' };
    return list;
  });
  const { container } = render(<AdminFeedbackPage />);
  fireEvent.click(screen.getByRole('button', { name: '긍정적' }));
  expect(container.querySelector('[data-component$="skeleton-content"]')).toBeInTheDocument();
  expect(screen.queryByText('피드백이 없습니다')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '부정적' }));
  expect(screen.getByRole('alert')).toHaveTextContent('피드백을 불러오지 못했습니다');
  fireEvent.click(screen.getByRole('button', { name: '전체' }));
  expect(screen.getByText('피드백이 없습니다')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
