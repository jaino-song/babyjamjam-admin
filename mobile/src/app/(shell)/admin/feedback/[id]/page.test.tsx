import { fireEvent, render, screen } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import FeedbackDetailPage from './page';

jest.mock('@tanstack/react-query', () => ({ useQuery: jest.fn() }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), useParams: () => ({ id: 'feedback-1' }) }));
jest.mock('remark-gfm', () => () => {});

const refetch = jest.fn();
const success = { isLoading: false, isPaused: false, isError: false, isFetching: false, status: 'success', fetchStatus: 'idle', refetch };
const detail = { type: 'positive', comment: 'Cached detail', createdAt: '2026-09-18', user: { name: 'Cached user' }, message: { id: 'message-1' }, session: { messages: [] } };
let query: Record<string, unknown>;

beforeEach(() => {
  refetch.mockReset();
  query = { ...success, data: detail };
  (useQuery as jest.Mock).mockImplementation(() => query);
});

it.each([new Error('network'), { response: { status: 500 } }])('retries an unknown failed detail instead of claiming not found', (error) => {
  query = { ...success, data: undefined, isError: true, error, status: 'error' };
  render(<FeedbackDetailPage />);
  expect(screen.getByRole('alert')).toHaveTextContent('피드백을 불러오지 못했습니다');
  expect(screen.queryByText('피드백을 찾을 수 없습니다')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  expect(refetch).toHaveBeenCalledTimes(1);
});

it.each(['404', 'empty'])('keeps the existing not-found card for %s', (state) => {
  query = { ...success, data: null, ...(state === '404' ? { isError: true, status: 'error', error: { response: { status: 404 } } } : {}) };
  render(<FeedbackDetailPage />);
  expect(screen.getByText('피드백을 찾을 수 없습니다')).toBeInTheDocument();
  expect(screen.getByText('요청하신 피드백이 존재하지 않거나 삭제되었습니다.')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it.each(['loading', 'paused'])('shows the existing skeleton for %s', (state) => {
  query = { ...success, data: undefined, isPending: true, isLoading: state === 'loading', isPaused: state === 'paused', isFetching: state === 'loading', status: 'pending', fetchStatus: state === 'paused' ? 'paused' : 'fetching' };
  const { container } = render(<FeedbackDetailPage />);
  expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  expect(screen.queryByText('피드백을 찾을 수 없습니다')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('retains cached detail and a single first-child inline notice with retry', () => {
  query = { ...success, data: detail, isError: true, error: new Error('network'), status: 'error' };
  const { rerender } = render(<FeedbackDetailPage />);
  expect(screen.getByText('Cached detail')).toBeInTheDocument();
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  const alert = screen.getByRole('alert');
  expect(alert).toHaveAttribute('data-size', 'inline');
  expect(alert.parentElement?.firstElementChild).toBe(alert);
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  expect(refetch).toHaveBeenCalledTimes(1);
  query = { ...query, isFetching: true, fetchStatus: 'fetching' };
  rerender(<FeedbackDetailPage />);
  expect(screen.getByRole('button', { name: '다시 시도' })).toBeDisabled();
});

it('keeps successful or paused cached detail without an alert', () => {
  const { rerender } = render(<FeedbackDetailPage />);
  expect(screen.getByText('Cached detail')).toBeInTheDocument();
  query = { ...query, isPaused: true, fetchStatus: 'paused' };
  rerender(<FeedbackDetailPage />);
  expect(screen.getByText('Cached detail')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
