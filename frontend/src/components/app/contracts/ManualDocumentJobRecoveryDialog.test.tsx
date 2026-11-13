import { StrictMode, useState } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { eformsignApi } from '@/services/eformsign';
import { api } from '@/lib/api/client';
import { RECOVERY_BRIDGE_CHANNEL, createRecoveryBridgeInit } from '@/lib/eformsign/recovery-bridge';
import { verifyManualRecoveryRequestSchema, type VerifyManualRecoveryResponse } from '@/lib/eformsign/manual-recovery-contract';
import { ManualDocumentJobRecoveryDialog } from './ManualDocumentJobRecoveryDialog';
import { ContractDocumentJobsPopover } from './ContractDocumentJobsPopover';

const showToast = jest.fn();
jest.mock('@/hooks/use-toast', () => ({ toast: (...args: unknown[]) => showToast(...args) }));
jest.mock('@/lib/api/client', () => ({ api: { post: jest.fn() } }));
jest.mock('next/navigation', () => ({ usePathname: () => '/contracts', useRouter: () => ({ push: jest.fn() }) }));
const refreshSummary = jest.fn(), refreshJobs = jest.fn();
jest.mock('@/features/document-jobs/DocumentJobsProvider', () => ({ useDocumentJobs: () => ({ refetchSummary: refreshSummary, refetchJobs: refreshJobs }) }));
const open = jest.fn(), verify = jest.fn();
const jobId = '11111111-1111-4111-8111-111111111111';
const ids = { companyId: 'company-abc', templateId: 'template_ABC', documentId: 'document012' };
const editable = () => ({ kind: 'editable' as const, jobId, claimEpoch: '42', claimExpiresAt: new Date(Date.now() + 60000).toISOString(), document: ids });
const pending = { kind: 'pending' as const, jobId, claimEpoch: '42' };
const close = jest.fn();
const { renderToString } = jest.requireActual<typeof import('react-dom/server')>('react-dom/server.node');
function tree() { return <ManualDocumentJobRecoveryDialog jobId={jobId} onClose={close} data-component="desktop_contracts_document-job-recovery" />; }
async function frameSession() {
  const frame = await screen.findByTitle<HTMLIFrameElement>('이폼사인 수동 전송');
  const nonce = frame.getAttribute('src')!.split('#')[1];
  const post = jest.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {});
  const message = (type: string, extra = {}, source: MessageEventSource | null = frame.contentWindow, origin = window.location.origin) =>
    act(() => { window.dispatchEvent(new MessageEvent('message', { origin, source, data: { channel: RECOVERY_BRIDGE_CHANNEL, version: 1, nonce, type, ...extra } })); });
  return { frame, nonce, post, message };
}
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  jest.clearAllMocks(); open.mockResolvedValue(editable()); verify.mockResolvedValue(pending);
  refreshJobs.mockResolvedValue({ data: { active: [], requiresAttention: [], recent: [] } });
  jest.spyOn(eformsignApi, 'resolveDocumentJob');
  jest.mocked(api.post).mockImplementation(async (url, body) => {
    if (url === `/eformsign-docs/jobs/${jobId}/recovery/open`) return { data: await open(jobId) };
    if (url === `/eformsign-docs/jobs/${jobId}/recovery/verify`) return { data: await verify(jobId, verifyManualRecoveryRequestSchema.parse(body).claimEpoch) };
    throw new Error('Unexpected local transport target');
  });
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test.each([1024, 1280])('desktop StrictMode viewport %s opens once and initializes only the fixed bridge with public IDs', async width => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  render(<StrictMode>{tree()}</StrictMode>);
  const h = await frameSession();
  expect(open).toHaveBeenCalledTimes(1);
  expect(h.frame).toHaveAttribute('src', `/eformsign-recovery-bridge.html#${h.nonce}`);
  expect(h.nonce).toMatch(/^[a-f0-9]{64}$/);
  expect(h.frame).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
  h.message('READY'); fireEvent.load(h.frame); h.message('READY');
  expect(h.post.mock.calls).toEqual([[createRecoveryBridgeInit(h.nonce, ids), window.location.origin]]);
  expect(document.querySelector('script[src*="eformsign.com"]')).toBeNull();
  expect(screen.getByRole('dialog')).toHaveClass('z-[1010]');
});


test('verified closes the editor with a success toast and refreshes the job detail', async () => {
  verify.mockResolvedValue({ ...pending, kind: 'verified' });
  render(tree()); const h = await frameSession(); h.message('CHANGED');
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(showToast).toHaveBeenCalledWith({ variant: 'success', description: '전자문서를 전송했어요' });
  expect(refreshJobs).toHaveBeenCalledTimes(1); expect(refreshSummary).toHaveBeenCalledTimes(1);
});

test.each([true, false])('verify_only closes without a dialog or verify and refetches completed=%s', async completed => {
  open.mockResolvedValue({ kind: 'verify_only', jobId, claimEpoch: '42', claimExpiresAt: editable().claimExpiresAt });
  refreshJobs.mockImplementation(async () => {
    expect(close).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    return { data: { active: [], requiresAttention: [], recent: completed ? [{ jobId, status: 'completed' }] : [] } };
  });
  render(tree());
  await waitFor(() => expect(showToast).toHaveBeenCalledWith({ variant: completed ? 'success' : 'destructive', description: completed ? '전자문서를 전송했어요' : '이폼사인 상태를 확인하지 못했어요. 잠시 후 다시 눌러 주세요.' }));
  expect(verify).not.toHaveBeenCalled(); expect(document.querySelector('iframe')).toBeNull();
});

test('wrong identity/envelope is ignored and concurrent CHANGED events serialize', async () => {
  let finish!: (value: VerifyManualRecoveryResponse) => void;
  verify.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(tree()); const h = await frameSession();
  h.message('CHANGED', {}, h.frame.contentWindow, 'https://evil.example');
  h.message('CHANGED', {}, window); h.message('CHANGED', { nonce: 'b'.repeat(64) }); h.message('CHANGED', { claimEpoch: '41' });
  expect(verify).not.toHaveBeenCalled();
  h.message('CHANGED'); h.message('CHANGED'); expect(verify).toHaveBeenCalledTimes(1);
  await act(async () => { finish(pending); });
  expect(close).not.toHaveBeenCalled(); expect(refreshJobs).not.toHaveBeenCalled(); expect(showToast).not.toHaveBeenCalled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: '결과 확인' })).not.toBeInTheDocument();
});

test.each(['x', 'unmount'])('%s sends CLOSE, removes listeners and ignores late messages without a toast', async how => {
  const view = render(tree()); const h = await frameSession();
  const remove = jest.spyOn(window, 'removeEventListener');
  if (how === 'x') fireEvent.click(screen.getByRole('button', { name: 'Close' })); else view.unmount();
  expect(close).toHaveBeenCalledTimes(how === 'x' ? 1 : 0);
  expect(h.post).toHaveBeenCalledWith(expect.objectContaining({ type: 'CLOSE', nonce: h.nonce }), window.location.origin);
  expect(remove.mock.calls.some(([type, listener]) => type === 'message' && typeof listener === 'function' && listener.name === 'receive')).toBe(true);
  h.message('CHANGED'); h.message('ERROR'); view.unmount();
  expect(verify).not.toHaveBeenCalled(); expect(showToast).not.toHaveBeenCalled(); expect(eformsignApi.resolveDocumentJob).not.toHaveBeenCalled();
});

test.each([true, false])('expiry closes before refetch, never verifies an expired reservation, completed=%s', async completed => {
  jest.useFakeTimers(); open.mockResolvedValue({ ...editable(), claimExpiresAt: new Date(Date.now() + 1000).toISOString() });
  refreshJobs.mockResolvedValue({ data: { active: [], requiresAttention: [], recent: completed ? [{ jobId, status: 'completed' }] : [] } });
  render(tree()); const h = await frameSession();
  await act(async () => { jest.advanceTimersByTime(1001); });
  expect(close).toHaveBeenCalledTimes(1); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(refreshJobs).toHaveBeenCalledTimes(1); expect(verify).not.toHaveBeenCalled();
  expect(showToast).toHaveBeenCalledWith({ variant: completed ? 'success' : 'destructive', description: completed ? '전자문서를 전송했어요' : '10분이 지나 화면이 닫혔어요. 수동 전송 버튼을 다시 누르면 이어서 진행할 수 있어요.' });
  h.message('CHANGED'); expect(open).toHaveBeenCalledTimes(1); expect(verify).not.toHaveBeenCalled();
});

test.each([true, false])('bridge ERROR closes and checks once, sent=%s', async sent => {
  let finish!: (value: VerifyManualRecoveryResponse) => void;
  verify.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(tree()); const h = await frameSession(); fireEvent.load(h.frame); h.message('READY');
  expect(h.post).toHaveBeenCalledTimes(1);
  h.message('ERROR'); h.message('ERROR');
  expect(close).toHaveBeenCalledTimes(1); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(verify).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ ...pending, kind: sent ? 'verified' : 'pending' }); });
  expect(showToast).toHaveBeenCalledWith({ variant: sent ? 'success' : 'destructive', description: sent ? '전자문서를 전송했어요' : '이폼사인 연결에 실패했어요. 잠시 후 다시 시도해 주세요.' });
  expect(open).toHaveBeenCalledTimes(1);
  expect(refreshJobs).toHaveBeenCalledTimes(sent ? 1 : 0);
  expect(refreshSummary).toHaveBeenCalledTimes(sent ? 1 : 0);
});

test.each(['changed', 'close'])('a failed live check keeps the editor open without a toast until %s', async next => {
  verify.mockRejectedValueOnce(new Error('private'));
  render(tree()); const h = await frameSession();
  await act(async () => { h.message('CHANGED'); });
  expect(verify).toHaveBeenCalledTimes(1);
  expect(screen.getByTitle('이폼사인 수동 전송')).toBe(h.frame);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(close).not.toHaveBeenCalled(); expect(showToast).not.toHaveBeenCalled();
  expect(refreshJobs).not.toHaveBeenCalled(); expect(refreshSummary).not.toHaveBeenCalled();
  expect(h.post).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'CLOSE' }), expect.anything());
  if (next === 'changed') {
    verify.mockResolvedValueOnce({ ...pending, kind: 'verified' });
    await act(async () => { h.message('CHANGED'); });
    expect(verify).toHaveBeenCalledTimes(2);
    expect(showToast).toHaveBeenCalledWith({ variant: 'success', description: '전자문서를 전송했어요' });
    expect(refreshJobs).toHaveBeenCalledTimes(1); expect(refreshSummary).toHaveBeenCalledTimes(1);
  } else {
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(verify).toHaveBeenCalledTimes(1); expect(showToast).not.toHaveBeenCalled();
  }
  expect(close).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test.each(['refetch', 'bridge'])('%s check failure closes with the result-check toast', async kind => {
  if (kind === 'refetch') {
    open.mockResolvedValue({ kind: 'verify_only', jobId, claimEpoch: '42', claimExpiresAt: editable().claimExpiresAt });
    refreshJobs.mockResolvedValue({ error: new Error('private') }); render(tree());
  } else {
    verify.mockRejectedValue(new Error('private')); render(tree()); const h = await frameSession(); h.message('ERROR');
  }
  await waitFor(() => expect(showToast).toHaveBeenCalledWith({ variant: 'destructive', description: '전송 결과를 확인하지 못했어요. 잠시 후 수동 전송을 다시 눌러 주세요.' }));
  expect(close).toHaveBeenCalledTimes(1); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test.each([
  [401, 'RECOVERY_UNAVAILABLE', '로그인이 필요해요. 다시 로그인한 뒤 작업을 열어 주세요.'],
  [403, 'RECOVERY_UNAVAILABLE', '이 작업은 관리자 권한이 필요해요. 지점 관리자에게 요청해 주세요.'],
  [409, 'RECOVERY_UNAVAILABLE', '다른 곳에서 처리 중이거나 작업 상태가 바뀌었어요. 목록에서 다시 확인해 주세요.'],
  [503, 'RECOVERY_UNAVAILABLE', '이폼사인 상태를 확인하지 못했어요. 잠시 후 다시 눌러 주세요.'],
])('open failure %s uses safe toast copy and closes without an empty dialog', async (status, code, description) => {
  open.mockRejectedValue({ isAxiosError: true, response: { status, data: { code, message: 'private-provider' } } });
  render(tree());
  await waitFor(() => expect(showToast).toHaveBeenCalledWith({ variant: 'destructive', description }));
  expect(close).toHaveBeenCalledTimes(1); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(verify).not.toHaveBeenCalled();
});

test.each(['x', 'unmount'])('a verification arriving after %s cannot refresh or show a toast', async how => {
  let finish!: (value: VerifyManualRecoveryResponse) => void;
  verify.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = render(tree()); const h = await frameSession(); h.message('CHANGED');
  if (how === 'x') fireEvent.click(screen.getByRole('button', { name: 'Close' })); else view.unmount();
  await act(async () => { finish({ ...pending, kind: 'verified' }); });
  expect(refreshJobs).not.toHaveBeenCalled(); expect(refreshSummary).not.toHaveBeenCalled(); expect(showToast).not.toHaveBeenCalled();
});

test('late open responses after unmount cannot create a frame or initialize it', async () => {
  let finish!: (value: ReturnType<typeof editable>) => void;
  open.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<StrictMode>{tree()}</StrictMode>); view.unmount();
  await act(async () => { finish(editable()); });
  expect(open).toHaveBeenCalledTimes(1); expect(screen.queryByTitle('이폼사인 수동 전송')).not.toBeInTheDocument(); expect(showToast).not.toHaveBeenCalled();
});

test('initial expiry and throttled timers refetch without allowing callback verification', async () => {
  jest.useFakeTimers(); open.mockResolvedValue({ ...editable(), claimExpiresAt: new Date(Date.now() - 1).toISOString() });
  const first = render(tree()); await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); first.unmount();
  open.mockResolvedValue({ ...editable(), claimExpiresAt: new Date(Date.now() + 1000).toISOString() });
  render(tree()); const h = await frameSession();
  await act(async () => { jest.setSystemTime(Date.now() + 2000); h.message('CHANGED'); });
  expect(verify).not.toHaveBeenCalled(); expect(refreshJobs).toHaveBeenCalledTimes(2); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

function RouteEntry({ onCloseAutoFocus }: { onCloseAutoFocus?: (event: Event) => void }) {
  const [shown, setShown] = useState(true);
  return <><ContractDocumentJobsPopover /><button id="custom-focus">사용자 초점</button>
    {shown ? <ManualDocumentJobRecoveryDialog jobId={jobId} onClose={() => setShown(false)} onCloseAutoFocus={onCloseAutoFocus} /> : null}</>;
}
describe.each([390, 1280])('route recovery without an editor at %spx', width => {
  test.each(['503', 'verify_only', 'expired'])('%s returns focus to the jobs trigger once', async ending => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    if (ending === '503') open.mockRejectedValue({ isAxiosError: true, response: { status: 503 } });
    else if (ending === 'verify_only') open.mockResolvedValue({ kind: 'verify_only', jobId, claimEpoch: '42', claimExpiresAt: editable().claimExpiresAt });
    else open.mockResolvedValue({ ...editable(), claimExpiresAt: new Date(Date.now() - 1).toISOString() });
    render(<RouteEntry />);
    const trigger = document.querySelector<HTMLButtonElement>('[data-slot="document-jobs-trigger"]')!;
    const focus = jest.spyOn(trigger, 'focus');
    await waitFor(() => expect(trigger).toHaveFocus());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(focus).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

test.each([390, 1280])('same embedded dialog at %spx closes to the jobs trigger without a toast', async width => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  render(<RouteEntry />); await frameSession();
  expect(screen.getByRole('dialog', { name: '전자문서 수동 전송' })).toHaveClass('max-lg:h-dvh', 'max-lg:w-screen');
  const trigger = document.querySelector<HTMLButtonElement>('[data-slot="document-jobs-trigger"]')!;
  const focus = jest.spyOn(trigger, 'focus');
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(trigger).toHaveFocus());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(focus).toHaveBeenCalledTimes(1);
  expect(showToast).not.toHaveBeenCalled(); expect(open).toHaveBeenCalledTimes(1);
});

test('SSR renders nothing and hydration opens exactly once on a phone', async () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  const container = document.createElement('div'); document.body.appendChild(container);
  container.innerHTML = renderToString(<StrictMode>{tree()}</StrictMode>);
  expect(container.innerHTML).toBe(''); expect(open).not.toHaveBeenCalled();
  let root!: Root;
  try {
    await act(async () => { root = hydrateRoot(container, <StrictMode>{tree()}</StrictMode>); });
    await frameSession(); expect(open).toHaveBeenCalledTimes(1);
  } finally { act(() => root?.unmount()); container.remove(); }
});

test('viewport shrink preserves the same editor without reopening', async () => {
  render(tree()); const h = await frameSession();
  act(() => { Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 }); window.dispatchEvent(new Event('resize')); });
  expect(screen.getByTitle('이폼사인 수동 전송')).toBe(h.frame); expect(open).toHaveBeenCalledTimes(1);
});

test('explicit close-focus callback retains ownership', async () => {
  const custom = jest.fn((event: Event) => { event.preventDefault(); document.getElementById('custom-focus')!.focus(); });
  render(<RouteEntry onCloseAutoFocus={custom} />); await frameSession();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(document.getElementById('custom-focus')).toHaveFocus()); expect(custom).toHaveBeenCalledTimes(1);
});
