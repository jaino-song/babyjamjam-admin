import { StrictMode, useState } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { eformsignApi } from '@/services/eformsign';
import { api } from '@/lib/api/client';
import { RECOVERY_BRIDGE_CHANNEL, createRecoveryBridgeInit } from '@/lib/eformsign/recovery-bridge';
import { verifyManualRecoveryRequestSchema, type VerifyManualRecoveryResponse } from '@/lib/eformsign/manual-recovery-contract';
import { ManualDocumentJobRecoveryDialog } from './ManualDocumentJobRecoveryDialog';
import { ContractDocumentJobsPopover } from './ContractDocumentJobsPopover';

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

test('verify_only never mounts a frame; pending is not complete and verified refreshes once', async () => {
  open.mockResolvedValue({ kind: 'verify_only', jobId, claimEpoch: '42', claimExpiresAt: editable().claimExpiresAt });
  render(tree());
  const button = await screen.findByRole('button', { name: '결과 확인' });
  expect(screen.queryByTitle('이폼사인 수동 전송')).not.toBeInTheDocument();
  fireEvent.click(button);
  await screen.findByText('아직 전송 결과가 확인되지 않았어요. 확인 후 다시 눌러 주세요.');
  expect(refreshJobs).not.toHaveBeenCalled();
  verify.mockResolvedValue({ ...pending, kind: 'verified' }); fireEvent.click(button);
  await screen.findByText('서버에서 전송 결과를 확인했어요.');
  expect(refreshJobs).toHaveBeenCalledTimes(1); expect(refreshSummary).toHaveBeenCalledTimes(1);
  expect(verify.mock.calls).toEqual([[jobId, '42'], [jobId, '42']]);
  expect(eformsignApi.resolveDocumentJob).not.toHaveBeenCalled();
});

test('wrong identity/envelope is ignored; concurrent CHANGED and manual clicks serialize', async () => {
  let finish!: (value: VerifyManualRecoveryResponse) => void;
  verify.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(tree()); const h = await frameSession();
  h.message('CHANGED', {}, h.frame.contentWindow, 'https://evil.example');
  h.message('CHANGED', {}, window); h.message('CHANGED', { nonce: 'b'.repeat(64) });
  h.message('CHANGED', { claimEpoch: '41' });
  expect(verify).not.toHaveBeenCalled();
  h.message('CHANGED'); h.message('CHANGED'); fireEvent.click(screen.getByRole('button', { name: '확인 중…' }));
  expect(verify).toHaveBeenCalledTimes(1);
  await act(async () => { finish(pending); });
  expect(refreshJobs).not.toHaveBeenCalled();
});

test('close and unmount send CLOSE, remove listeners and prevent late callbacks or resolve', async () => {
  const view = render(tree()); const h = await frameSession();
  const remove = jest.spyOn(window, 'removeEventListener');
  fireEvent.click(screen.getByRole('button', { name: '닫기' }));
  expect(close).toHaveBeenCalledTimes(1);
  expect(h.post).toHaveBeenCalledWith(expect.objectContaining({ type: 'CLOSE', nonce: h.nonce }), window.location.origin);
  expect(remove.mock.calls.some(([type, listener]) => type === 'message' && typeof listener === 'function' && listener.name === 'receive')).toBe(true);
  h.message('CHANGED'); view.unmount(); h.message('CHANGED');
  expect(verify).not.toHaveBeenCalled(); expect(eformsignApi.resolveDocumentJob).not.toHaveBeenCalled();
});

test('expiry tears down the frame without reopening; stale verification cannot refresh', async () => {
  jest.useFakeTimers(); open.mockResolvedValue({ ...editable(), claimExpiresAt: new Date(Date.now() + 1000).toISOString() });
  render(tree()); const h = await frameSession();
  act(() => { jest.advanceTimersByTime(1001); });
  expect(screen.queryByTitle('이폼사인 수동 전송')).not.toBeInTheDocument();
  h.message('CHANGED'); expect(verify).not.toHaveBeenCalled(); expect(open).toHaveBeenCalledTimes(1);
  verify.mockResolvedValue({ ...pending, kind: 'verified', claimEpoch: '41' });
  fireEvent.click(screen.getByRole('button', { name: '결과 확인' }));
  await waitFor(() => expect(screen.getByText('결과를 확인하지 못했어요. 잠시 후 결과 확인을 다시 눌러 주세요.')).toBeInTheDocument());
  expect(refreshJobs).not.toHaveBeenCalled();
});

test.each([401, 403, 409])('refused %s never shows iframe or raw error text', async status => {
  open.mockRejectedValue({ isAxiosError: true, response: { status, data: { code: 'RECOVERY_UNSUPPORTED', reason: 'legacy_unbound', message: 'private-provider' } } });
  render(tree());
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  expect(screen.queryByTitle('이폼사인 수동 전송')).not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain('private-provider'); expect(verify).not.toHaveBeenCalled();
});

test('onLoad can initialize first, and bridge ERROR never proves completion or retries open', async () => {
  render(tree()); const h = await frameSession();
  fireEvent.load(h.frame); h.message('READY');
  expect(h.post).toHaveBeenCalledTimes(1);
  h.message('ERROR');
  expect(screen.getByText('전자문서 화면을 확인하지 못했어요. 결과 확인을 눌러 서버 상태를 확인해 주세요.')).toBeInTheDocument();
  expect(verify).not.toHaveBeenCalled(); expect(refreshJobs).not.toHaveBeenCalled(); expect(open).toHaveBeenCalledTimes(1);
});

test('a verify response arriving after unmount cannot refresh the jobs provider', async () => {
  let finish!: (value: VerifyManualRecoveryResponse) => void;
  verify.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = render(tree()); const h = await frameSession(); h.message('CHANGED');
  expect(verify).toHaveBeenCalledTimes(1); view.unmount();
  expect(h.post).toHaveBeenCalledWith(expect.objectContaining({ type: 'CLOSE' }), window.location.origin);
  await act(async () => { finish({ ...pending, kind: 'verified' }); });
  expect(refreshJobs).not.toHaveBeenCalled(); expect(refreshSummary).not.toHaveBeenCalled();
});

test('late open responses after unmount cannot create a frame or initialize it', async () => {
  let finish!: (value: ReturnType<typeof editable>) => void;
  open.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<StrictMode>{tree()}</StrictMode>); view.unmount();
  await act(async () => { finish(editable()); });
  expect(open).toHaveBeenCalledTimes(1); expect(screen.queryByTitle('이폼사인 수동 전송')).not.toBeInTheDocument();
});

test('an expired initial session and throttled expiry timer never allow an iframe callback to verify', async () => {
  jest.useFakeTimers(); open.mockResolvedValue({ ...editable(), claimExpiresAt: new Date(Date.now() - 1).toISOString() });
  const first = render(tree()); await screen.findByText('화면 이용 시간이 지났어요. 결과 확인으로 서버 상태를 확인해 주세요.');
  expect(screen.queryByTitle('이폼사인 수동 전송')).not.toBeInTheDocument(); first.unmount();
  open.mockResolvedValue({ ...editable(), claimExpiresAt: new Date(Date.now() + 1000).toISOString() });
  render(tree()); const h = await frameSession();
  jest.setSystemTime(Date.now() + 2000); h.message('CHANGED');
  expect(verify).not.toHaveBeenCalled(); expect(screen.queryByTitle('이폼사인 수동 전송')).not.toBeInTheDocument();
});

test.each([401, 403])('verify denial %s displays actionable safe copy', async status => {
  render(tree()); await frameSession();
  verify.mockRejectedValue({ isAxiosError: true, response: { status, data: { message: 'private' } } });
  fireEvent.click(screen.getByRole('button', { name: '결과 확인' }));
  await screen.findByText(status === 401 ? '로그인이 필요해요. 다시 로그인한 뒤 작업을 열어 주세요.' : '이 작업은 관리자 권한이 필요해요. 지점 관리자에게 요청해 주세요.');
  expect(screen.queryByTitle('이폼사인 수동 전송')).not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain('private');
});

function RouteEntry({ onCloseAutoFocus }: { onCloseAutoFocus?: (event: Event) => void }) {
  const [shown, setShown] = useState(true);
  return <><ContractDocumentJobsPopover /><button id="custom-focus">사용자 초점</button>
    {shown ? <ManualDocumentJobRecoveryDialog jobId={jobId} onClose={() => setShown(false)} onCloseAutoFocus={onCloseAutoFocus} /> : null}</>;
}

test.each([390, 1280])('route entry close restores the jobs trigger at viewport %s', async width => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  open.mockRejectedValue({ isAxiosError: true, response: { status: 409, data: { code: 'RECOVERY_UNSUPPORTED' } } });
  render(<RouteEntry />);
  await screen.findByText(width < 1024 ? '수동 전송은 PC에서 확인해 주세요.' : '이전 방식으로 생성됐거나 수동 화면을 지원하지 않는 작업이에요. 관리자에게 확인해 주세요.');
  const trigger = document.querySelector('[data-slot="document-jobs-trigger"]');
  fireEvent.click(screen.getByRole('button', { name: '닫기' }));
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(screen.queryByTitle('이폼사인 수동 전송')).not.toBeInTheDocument();
});

test.each([390, 1023])('initial mobile StrictMode viewport %s never opens or verifies despite the existing hook initial false', async width => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  render(<StrictMode>{tree()}</StrictMode>);
  await screen.findByText('수동 전송은 PC에서 확인해 주세요.');
  expect(open).not.toHaveBeenCalled(); expect(verify).not.toHaveBeenCalled(); expect(api.post).not.toHaveBeenCalled();
  expect(eformsignApi.resolveDocumentJob).not.toHaveBeenCalled();
  expect(document.querySelector('iframe')).toBeNull();
});

test('mobile server hydration never mounts the recovery session child', async () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  const container = document.createElement('div'); document.body.appendChild(container);
  container.innerHTML = renderToString(<StrictMode>{tree()}</StrictMode>);
  expect(open).not.toHaveBeenCalled();
  let root!: Root;
  try {
    await act(async () => { root = hydrateRoot(container, <StrictMode>{tree()}</StrictMode>); });
    expect(screen.getByText('수동 전송은 PC에서 확인해 주세요.')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled(); expect(document.querySelector('iframe')).toBeNull();
  } finally { act(() => root?.unmount()); container.remove(); }
});

test('viewport shrink unmounts the desktop session and blocks stale callbacks without reopening', async () => {
  render(tree()); const h = await frameSession();
  act(() => { Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 }); window.dispatchEvent(new Event('resize')); });
  await screen.findByText('수동 전송은 PC에서 확인해 주세요.'); h.message('CHANGED');
  expect(h.post).toHaveBeenCalledWith(expect.objectContaining({ type: 'CLOSE' }), window.location.origin);
  expect(screen.queryByTitle('이폼사인 수동 전송')).not.toBeInTheDocument();
  expect(open).toHaveBeenCalledTimes(1); expect(verify).not.toHaveBeenCalled(); expect(eformsignApi.resolveDocumentJob).not.toHaveBeenCalled();
});

test('an explicit nested close-focus callback keeps ownership instead of using the default fallback', async () => {
  const custom = jest.fn((event: Event) => { event.preventDefault(); document.getElementById('custom-focus')!.focus(); });
  render(<RouteEntry onCloseAutoFocus={custom} />); await frameSession();
  fireEvent.click(screen.getByRole('button', { name: '닫기' }));
  await waitFor(() => expect(document.getElementById('custom-focus')).toHaveFocus());
  expect(custom).toHaveBeenCalledTimes(1);
});
