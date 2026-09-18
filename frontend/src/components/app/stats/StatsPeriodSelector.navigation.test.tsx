import { fireEvent, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { StatsPeriodProvider, StatsPeriodSelector } from './StatsPeriodSelector';
import { PanelCard } from '@/app/(protected)/stats/_components/PanelCard';

const mockNavigate = jest.fn();
jest.mock('next/link', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    __esModule: true,
    default: React.forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement>>(
      function MockLink({ href, onClick, children, ...props }, ref) {
        return <a {...props} ref={ref} href={href} onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) mockNavigate(href);
          event.preventDefault();
        }}>{children}</a>;
      },
    ),
  };
});

function renderOverview() {
  return render(<StatsPeriodProvider initialPeriod={7}>
    <StatsPeriodSelector period={7} basePath="/stats" dataComponent="desktop_stats_period" />
    <PanelCard title="오류 통계" detailHref="/stats/errors?period=7" dataComponent="desktop_stats_errors">내용</PanelCard>
  </StatsPeriodProvider>);
}

beforeEach(() => mockNavigate.mockClear());

it('updates the real detail link handler before server props acknowledge the selected period', () => {
  renderOverview();
  fireEvent.click(screen.getByRole('link', { name: '최근 30일' }));
  fireEvent.click(screen.getByRole('link', { name: '전체 보기' }));
  expect(mockNavigate).toHaveBeenLastCalledWith('/stats/errors?period=30');
});

it('keeps the current page selection when the period link opens in another tab', () => {
  renderOverview();
  fireEvent.click(screen.getByRole('link', { name: '최근 30일' }), { metaKey: true });
  fireEvent.click(screen.getByRole('link', { name: '전체 보기' }));
  expect(mockNavigate).toHaveBeenLastCalledWith('/stats/errors?period=7');
});
