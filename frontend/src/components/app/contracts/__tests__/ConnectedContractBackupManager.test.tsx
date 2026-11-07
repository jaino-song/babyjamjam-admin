import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConnectedContractBackupManager } from '../ContractBackupManager';
import { useEformsignBackups } from '@/hooks/useEformsignBackups';
import type { BackupRun, BackupDocument } from '@/lib/eformsign-backup-api';
import { defaultDocumentScope } from '@/lib/eformsign-backup-view';
jest.mock('@/hooks/useEformsignBackups', () => ({ useEformsignBackups: jest.fn() }));
const hook = jest.mocked(useEformsignBackups);
const id = '20000000-0000-4000-8000-000000000001';
const at = '2026-11-05T00:00:00.000Z';
const run: BackupRun = { id, status: 'unverified', scope: defaultDocumentScope(), cut: at, createdAt: at, startedAt: at, finishedAt: at,
  summary: { target: 121, saved: 0, attention: 0, metadataOnly: 121, local: { state: 'excluded', saved: 0 }, drive: { state: 'excluded', saved: 0 } },
  coverage: 'unverified', backupComplete: false, failureCode: null };
const document: BackupDocument = { documentId: id, ordinal: 1, kind: 'contract', currentMilestone: 'created', documentCreatedAt: at,
  classification: 'excluded_by_policy', local: 'metadata_only', drive: 'metadata_only' };
let state: ReturnType<typeof useEformsignBackups>;
beforeEach(() => {
  state = { access: { identity: 'owner:A', userId: id, branchId: id, ready: true, isManager: true }, identity: 'owner:A',
    selectedId: id, selectRun: jest.fn(), runs: [run], run, documents: [document], state: 'ready', detailState: 'ready',
    hasMore: false, isFetchingMore: false, loadMore: jest.fn(), requestRun: jest.fn(), download: jest.fn(), downloadReady: true, requestReady: true };
  hook.mockImplementation(() => state);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});
const base = 'desktop_contracts_sections_section-content_backup-section_manager';
describe('connected backup presentation', () => {
  it('owns the live root and shows actual metadata-only counts without false missing PDF rows', () => {
    const { container } = render(<ConnectedContractBackupManager dataComponent={base} />);
    expect(container.querySelector(`[data-component="${base}"]`)).toHaveAttribute('data-source-component', 'ConnectedContractBackupManager');
    expect(screen.getByText('문서 정보만')).toBeInTheDocument(); expect(screen.getByText('121건')).toBeInTheDocument();
    expect(screen.queryByText('확인 필요한 문서')).not.toBeInTheDocument(); expect(screen.queryByText(/PDF|완료됨/)).not.toBeInTheDocument();
    for (const text of ['백업 요청', '백업 실행 시작', '실행 종료']) expect(screen.getByText(text)).toBeInTheDocument();
  });
  it('uses queued state without synthetic failures or absent timestamps', () => {
    const queued = { ...run, status: 'queued' as const, startedAt: null, finishedAt: null };
    state = { ...state, runs: [queued], run: queued, documents: [{ ...document, local: 'unverified', drive: 'unverified' }], downloadReady: false };
    render(<ConnectedContractBackupManager dataComponent={base} />);
    expect(screen.getAllByText('대기 중').length).toBeGreaterThan(0);
    expect(screen.queryByText('확인 필요한 문서')).not.toBeInTheDocument();
    expect(screen.queryByText('백업 실행 시작')).not.toBeInTheDocument(); expect(screen.queryByText('실행 종료')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '결과 내려받기' })).toBeDisabled();
  });
  it('only shows nonfulfilled terminal observations with classification-safe reasons', () => {
    state = { ...state, documents: [{ ...document, local: 'unverified', drive: 'unverified' }] };
    render(<ConnectedContractBackupManager dataComponent={base} />);
    expect(screen.getByText('문서 정보 보관 확인')).toBeInTheDocument();
    expect(screen.queryByText(/PDF/)).not.toBeInTheDocument();
  });
  it('guards rapid duplicate clicks and passes a cloned future scope', async () => {
    let resolve!: () => void;
    const request = jest.fn(() => new Promise<void>(r => { resolve = r; })); state = { ...state, requestRun: request };
    render(<ConnectedContractBackupManager dataComponent={base} />);
    const button = screen.getByRole('button', { name: '백업 실행' });
    fireEvent.click(button); fireEvent.click(button);
    expect(request).toHaveBeenCalledTimes(1); expect(button).toBeDisabled();
    expect(request.mock.calls[0]).toEqual([defaultDocumentScope()]);
    await act(async () => { resolve(); });
    await waitFor(() => expect(button).not.toBeDisabled());
  });
  it('hides old branch data on a new identity', () => {
    const { rerender } = render(<ConnectedContractBackupManager dataComponent={base} />);
    state = { ...state, identity: 'owner:B', selectedId: null, run: undefined, runs: [], documents: undefined, downloadReady: false };
    rerender(<ConnectedContractBackupManager dataComponent={base} />);
    expect(screen.queryByText('문서 정보만')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '결과 내려받기' })).toBeDisabled();
  });
});
