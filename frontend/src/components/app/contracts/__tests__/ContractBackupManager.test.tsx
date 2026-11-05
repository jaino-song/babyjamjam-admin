import fs from 'node:fs';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ContractBackupManager, type ContractBackupManagerProps } from '../ContractBackupManager';
import { defaultDocumentScope, type BackupRunView, type BackupViewSource } from '@/lib/eformsign-backup-view';

// jsdom has no ResizeObserver; Radix checkbox/radio controls require this browser API.
const originalResizeObserver = global.ResizeObserver;
beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterAll(() => { global.ResizeObserver = originalResizeObserver; });

const base = 'desktop_contracts_sections_section-content_backup-section_manager';
// Synthetic component-only inputs; the actual route never supplies a source.
const runs: readonly BackupRunView[] = [
  {
    id: 'test-manual', startedAt: '2026-11-05T01:00:00Z', finishedAt: '2026-11-05T01:10:00Z',
    trigger: 'manual', state: 'unverified', counts: { target: 12, saved: 12, attention: 0 },
    local: { state: 'stored', saved: 12, location: '로컬 경로' }, drive: { state: 'unverified' },
    missingDocuments: [], timeline: [{ id: 'start', at: '2026-11-05T01:00:00Z', text: '문서 수집 시작', tone: 'info' }],
  },
  {
    id: 'test-scheduled', startedAt: '2026-11-04T01:00:00Z', trigger: 'scheduled', state: 'partial',
    counts: { target: 15, saved: 11, attention: 4 }, local: { state: 'stored', saved: 11 },
    drive: { state: 'failed', saved: 2 }, missingDocuments: [{ id: 'missing', title: '확인할 문서', reason: '파일 확인 필요' }],
    timeline: [{ id: 'check', at: '2026-11-04T01:05:00Z', text: '저장 위치 확인 필요', tone: 'warning' }],
  },
];
const ready: BackupViewSource = { state: 'ready', runs, capabilities: { requestRun: true, download: true } };
function setup(props: Omit<ContractBackupManagerProps, 'dataComponent'> = {}) {
  const view = (next: Omit<ContractBackupManagerProps, 'dataComponent'>) => <main data-slot="main-content"><ContractBackupManager dataComponent={base} {...next} /></main>;
  const result = render(view(props));
  return { ...result, update: (next: Omit<ContractBackupManagerProps, 'dataComponent'>) => result.rerender(view(next)) };
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => { Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1496 }); });

describe('ContractBackupManager', () => {
  it('defaults to unavailable with no invented history, counts, or side effects', () => {
    const onRequestRun = jest.fn();
    const onDownload = jest.fn();
    setup({ onRequestRun, onDownload });
    expect(screen.getByText('백업 실행 이력')).toBeInTheDocument();
    expect(screen.getByText('연결 전')).toBeInTheDocument();
    expect(screen.getAllByText('백업 연결 전').length).toBeGreaterThan(0);
    expect(screen.queryByText('이력이 없습니다')).not.toBeInTheDocument();
    expect(screen.queryByText(/0건|예약 꺼짐|수동 실행|예약 실행/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '백업 실행' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '결과 내려받기' })).toBeDisabled();
    click('백업 실행'); click('결과 내려받기');
    expect(onRequestRun).not.toHaveBeenCalled();
    expect(onDownload).not.toHaveBeenCalled();
  });

  it.each(['loading', 'error'] as const)('keeps %s distinct from successful empty data', state => {
    const { container } = setup({ source: { state } });
    expect(screen.queryByText('이력이 없습니다')).not.toBeInTheDocument();
    expect(screen.queryByText(/대상 \d|저장 \d|0건/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '백업 실행' })).toBeDisabled();
    if (state === 'error') expect(screen.getAllByText('이력을 불러오지 못했습니다').length).toBeGreaterThan(0);
    else expect(container.querySelector('[data-component$="_runs_item_text-skeleton"]')).toBeInTheDocument();
  });

  it('shows a truthful ready empty state and disables download without selection', () => {
    setup({ source: { state: 'ready', runs: [], capabilities: { download: true } }, onDownload: jest.fn() });
    expect(screen.getByText('이력이 없습니다')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '결과 내려받기' })).toBeDisabled();
  });

  it('shows independent destination results, missing documents, metrics and timeline', () => {
    const { container } = setup({ source: ready });
    click(/예약 실행/);
    const detail = container.querySelector('[data-source-component="DetailPanel"]')!;
    expect(within(detail as HTMLElement).getByText('백업 결과')).toBeInTheDocument();
    expect(within(detail as HTMLElement).getByText('11')).toBeInTheDocument();
    expect(within(detail as HTMLElement).getByText('저장됨 · 11건')).toBeInTheDocument();
    expect(within(detail as HTMLElement).getByText('실패 · 2건')).toBeInTheDocument();
    expect(within(detail as HTMLElement).getByText('확인할 문서')).toBeInTheDocument();
    expect(within(detail as HTMLElement).getByText('파일 확인 필요')).toBeInTheDocument();
    expect(within(detail as HTMLElement).getByText('저장 위치 확인 필요')).toBeInTheDocument();
    expect(within(detail as HTMLElement).getByText('확인 전')).toBeInTheDocument();
    expect(within(detail as HTMLElement).queryByText('완료')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '백업 실행' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '결과 내려받기' })).toBeDisabled();
  });

  it('filters only attention runs and preserves or falls back selection', () => {
    const { container } = setup({ source: ready });
    click(/수동 실행/);
    click('확인 필요');
    expect(screen.queryByRole('button', { name: /수동 실행/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /예약 실행/ })).toHaveAttribute('aria-pressed', 'true');
    click('전체');
    expect(screen.getByRole('button', { name: /예약 실행/ })).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('[data-slot="split-layout"]')).toHaveAttribute('data-has-selection', 'true');
  });

  it('applies future scope in memory without changing recorded runs or calling callbacks', async () => {
    const onRequestRun = jest.fn();
    setup({ source: ready, onRequestRun });
    click('문서 필터');
    fireEvent.click(screen.getByRole('radio', { name: '계약서' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '계약서 단계 전체' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '계약서 단계 이용자 서명 완료' }));
    click('적용');
    expect(screen.getByText('전체 기간 · 계약서 · 계약서 이용자 서명 완료')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /수동 실행/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /예약 실행/ })).toBeInTheDocument();
    expect(onRequestRun).not.toHaveBeenCalled();
    expect(screen.queryByText(/저장했습니다|저장했어요/)).not.toBeInTheDocument();
    await act(async () => click('백업 실행'));
    expect(onRequestRun.mock.calls[0][0]).toMatchObject({ kind: 'contract', contractStages: ['signed'] });
  });

  it('requires both ready capability and callback, and clears stale details on source loss', () => {
    const onRequestRun = jest.fn();
    const onDownload = jest.fn();
    const { update } = setup({ source: { state: 'ready', runs }, onRequestRun, onDownload });
    click(/수동 실행/);
    expect(screen.getByRole('button', { name: '백업 실행' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '결과 내려받기' })).toBeDisabled();
    update({ source: ready, onRequestRun, onDownload });
    expect(screen.getByRole('button', { name: '백업 실행' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '결과 내려받기' })).toBeEnabled();
    update({ source: { state: 'error' }, onRequestRun, onDownload });
    expect(screen.queryByText('로컬 경로')).not.toBeInTheDocument();
    expect(screen.queryByText('저장됨 · 12건 · 로컬 경로')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '결과 내려받기' })).toBeDisabled();
  });

  it('guards duplicate run and download calls while pending and passes a cloned scope', async () => {
    let resolveRun!: () => void;
    const onRequestRun = jest.fn(() => new Promise<void>(resolve => { resolveRun = resolve; }));
    let resolveDownload!: () => void;
    const onDownload = jest.fn(() => new Promise<void>(resolve => { resolveDownload = resolve; }));
    setup({ source: ready, onRequestRun, onDownload });
    click(/수동 실행/);
    const runButton = screen.getByRole('button', { name: '백업 실행' });
    act(() => { fireEvent.click(runButton); fireEvent.click(runButton); });
    expect(onRequestRun).toHaveBeenCalledTimes(1);
    expect(onRequestRun).toHaveBeenCalledWith(defaultDocumentScope());
    expect(screen.getByRole('button', { name: '요청 중' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '결과 내려받기' })).toBeDisabled();
    await act(async () => resolveRun());
    const download = screen.getByRole('button', { name: '결과 내려받기' });
    act(() => { fireEvent.click(download); fireEvent.click(download); });
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onDownload).toHaveBeenCalledWith('test-manual');
    expect(screen.getByRole('button', { name: '내려받는 중' })).toBeDisabled();
    await act(async () => resolveDownload());
    expect(screen.getByRole('button', { name: '백업 실행' })).toBeEnabled();
  });

  it('shows concise callback failure copy without exposing raw exceptions', async () => {
    const onRequestRun = jest.fn().mockRejectedValue(new Error('private internal detail'));
    setup({ source: ready, onRequestRun });
    click('백업 실행');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('백업을 요청하지 못했습니다'));
    expect(screen.queryByText(/private internal detail/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '백업 실행' })).toBeEnabled();
  });
});

it('mounts the default manager on an enabled final backup navigation entry', () => {
  // The existing route suite uses source guards for this large page. Keep its pinned tests untouched.
  const source = fs.readFileSync(require.resolve('@/app/(protected)/contracts/page'), 'utf8');
  const nav = source.slice(source.indexOf('const NAV_SECTIONS ='), source.indexOf('type SectionId ='));
  expect(nav).toMatch(/id: "automations"[\s\S]*id: "backup", label: "전자문서 백업", icon: Archive \},\s*\] as const/);
  expect(source).toContain('activeSection === "backup"');
  expect(source).toContain('<ContractBackupManager dataComponent="desktop_contracts_sections_section-content_backup-section_manager" />');
});
