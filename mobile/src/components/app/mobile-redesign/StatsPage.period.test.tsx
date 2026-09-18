import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { StatsPage } from './StatsPage';

const mockRouter = { push: jest.fn(), replace: jest.fn() };
let mockParams = new URLSearchParams('period=7');
let mockPathname = '/stats';
let mockRole = 'owner';
const mockUseQuery = jest.fn((options: unknown) => {
  void options;
  return { data: { state: 'unavailable', data: null }, isLoading: false, isError: false, refetch: jest.fn() };
});
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => mockParams,
  usePathname: () => mockPathname,
}));
jest.mock('@tanstack/react-query', () => ({ useQuery: (options: unknown) => mockUseQuery(options) }));
jest.mock('@/providers/UserProvider', () => ({ useInitialUser: () => ({ id: 1, role: mockRole }) }));
jest.mock('@/lib/api/stats', () => ({ getStatsView: jest.fn() }));
jest.mock('./sliding-card', () => ({ SlidingCard: ({ open, onBack, list, detail }: { open: boolean; onBack: () => void; list: ReactNode; detail: ReactNode }) => open ? <><button onClick={onBack}>목록 복귀</button>{detail}</> : list }));
jest.mock('./StatsPeriodSelector', () => ({ StatsPeriodSelector: ({ period, onChange }: { period: number; onChange: (period: number) => void }) => <><output aria-label="선택 기간">{period}</output><button onClick={() => onChange(7)}>7일 선택</button><button onClick={() => onChange(30)}>30일 선택</button></> }));
jest.mock('./settings/SettingsListCard', () => ({
  SettingsListCard: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SettingsListItem: ({ ariaLabel, onSelect }: { ariaLabel: string; onSelect: () => void }) => <button aria-label={ariaLabel} onClick={onSelect} />,
  SettingsListRowsSkeleton: () => null,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = new URLSearchParams('period=7');
  mockPathname = '/stats';
  mockRole = 'owner';
});

it('uses the new period for immediate detail navigation and return before the URL update arrives', () => {
  const { rerender } = render(<StatsPage />);
  fireEvent.click(screen.getByRole('button', { name: '30일 선택' }));
  // The router has not acknowledged the replacement: searchParams still says 7.
  expect(screen.getByLabelText('선택 기간')).toHaveTextContent('30');
  fireEvent.click(screen.getByRole('button', { name: '오류 통계 보기' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/stats/errors?period=30', { scroll: false });
  expect(mockUseQuery).toHaveBeenCalledWith(expect.objectContaining({ queryKey: expect.arrayContaining(['stats', 'overview', 30]) }));

  mockPathname = '/stats/errors';
  rerender(<StatsPage view="errors" />);
  expect(screen.getByText('데이터 연결이 필요합니다.')).toBeVisible();
  expect(screen.getByLabelText('선택 기간')).toHaveTextContent('30');
  fireEvent.click(screen.getByRole('button', { name: '목록 복귀' }));
  expect(mockRouter.replace).toHaveBeenLastCalledWith('/stats?period=30', { scroll: false });
});

it('honors browser history after the selected period has been acknowledged by the URL', () => {
  const { rerender } = render(<StatsPage />);
  fireEvent.click(screen.getByRole('button', { name: '30일 선택' }));
  mockParams = new URLSearchParams('period=30');
  rerender(<StatsPage />);
  expect(screen.getByLabelText('선택 기간')).toHaveTextContent('30');
  mockParams = new URLSearchParams('period=7');
  rerender(<StatsPage />);
  expect(screen.getByLabelText('선택 기간')).toHaveTextContent('7');
  fireEvent.click(screen.getByRole('button', { name: '오류 통계 보기' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/stats/errors?period=7', { scroll: false });
});

it('shows only the inquiry entry for branch users', () => {
  mockRole = 'branch';
  render(<StatsPage />);
  expect(screen.getByRole('button', { name: '상담 통계 보기' })).toBeVisible();
  expect(screen.queryByRole('button', { name: '오류 통계 보기' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '페이지 이동 통계 보기' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '트래픽 통계 보기' })).not.toBeInTheDocument();
});
