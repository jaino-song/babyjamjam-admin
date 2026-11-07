import { render, within } from '@testing-library/react';
import { ContractBackupManager } from '../ContractBackupManager';
import type { BackupViewSource } from '@/lib/eformsign-backup-view';

const base = 'desktop_contracts_sections_section-content_backup-section_manager';
const list = `${base}_split-layout_track_panel_list-panel`;
const originalResizeObserver = global.ResizeObserver;
const originalIntersectionObserver = global.IntersectionObserver;
const observe = jest.fn();

beforeAll(() => {
  // jsdom does not implement the browser observers used by the real list components.
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  global.IntersectionObserver = jest.fn().mockImplementation(() => ({
    observe, unobserve: jest.fn(), disconnect: jest.fn(),
  }));
});
afterAll(() => {
  global.ResizeObserver = originalResizeObserver;
  global.IntersectionObserver = originalIntersectionObserver;
});
beforeEach(() => { observe.mockClear(); });

function listPanel(container: HTMLElement) {
  const panel = container.querySelector<HTMLElement>('[data-source-component="ListPanel"]');
  if (!panel) throw new Error('Expected the backup history ListPanel');
  return panel;
}

describe('ContractBackupManager empty content placement', () => {
  it.each<[BackupViewSource, string]>([
    [{ state: 'ready', runs: [] }, '이력이 없습니다'],
    [{ state: 'error' }, '이력을 불러오지 못했습니다'],
    [{ state: 'unavailable' }, '백업 연결 전'],
  ])('keeps the %s message inside scroll content before the animated list and outside the header and overlay', (source, message) => {
    const { container } = render(<ContractBackupManager dataComponent={base} source={source} />);
    const panel = listPanel(container);
    const copy = within(panel).getByText(message);
    const empty = copy.closest<HTMLElement>('[data-source-component="ListEmptyState"]');
    const content = panel.querySelector('[data-slot="list-panel-content"]');
    const animatedList = panel.querySelector('[data-slot="animated-slot-list"]');

    expect(empty).toBeInTheDocument();
    expect(animatedList).not.toBeNull();
    if (!empty || !animatedList) throw new Error('Expected the empty state and animated list');
    expect(empty.compareDocumentPosition(animatedList) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(content).toContainElement(empty);
    expect(empty).toHaveAttribute('data-component', `${list}_content_empty`);
    expect(copy.closest('[data-slot="list-panel-top-area"]')).toBeNull();
    expect(panel.querySelector('[data-slot="list-panel-overlay"]')).not.toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: '문서 필터' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: '백업 실행' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: '전체' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: '확인 필요' })).toBeInTheDocument();
  });

  it('renders the animated loading row without an empty message while history is loading', () => {
    const { container } = render(<ContractBackupManager dataComponent={base} source={{ state: 'loading' }} />);
    const panel = listPanel(container);

    expect(panel.querySelector('[data-source-component="ListEmptyState"]')).not.toBeInTheDocument();
    expect(within(panel).queryByText('이력이 없습니다')).not.toBeInTheDocument();
    expect(within(panel).queryByText('이력 불러오는 중')).not.toBeInTheDocument();
    expect(panel.querySelector(`[data-component="${list}_content_runs_item_text-skeleton"]`)).toBeInTheDocument();
  });

  it('keeps the animated list and observed load-more sentinel mounted alongside empty content', () => {
    const onLoadMore = jest.fn();
    const view = (source: BackupViewSource) => (
      <ContractBackupManager dataComponent={base} source={source} hasMore onLoadMore={onLoadMore} />
    );
    const { container, rerender } = render(view({ state: 'ready', runs: [] }));
    const panel = listPanel(container);
    const sentinel = panel.querySelector('[data-slot="fetch-more"]');

    expect(sentinel).toBeInTheDocument();
    expect(sentinel?.closest('[data-slot="list-panel-content"]')).toContainElement(within(panel).getByText('이력이 없습니다'));
    expect(observe).toHaveBeenCalledWith(sentinel);

    rerender(view({ state: 'loading' }));
    expect(panel.querySelector('[data-slot="fetch-more"]')).toBe(sentinel);
    expect(panel.querySelector('[data-source-component="ListEmptyState"]')).not.toBeInTheDocument();

    rerender(view({ state: 'ready', runs: [] }));
    expect(panel.querySelector('[data-slot="fetch-more"]')).toBe(sentinel);
    expect(within(panel).getByText('이력이 없습니다')).toBeInTheDocument();
  });
});
