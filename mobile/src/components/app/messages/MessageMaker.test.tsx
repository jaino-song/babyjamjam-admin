import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useGetAuthUser } from '@/hooks/useGetAuthUser';
import { useSystemTemplates } from '@/features/system-templates/hooks/useSystemTemplates';
import { useMessageTemplates } from '@/hooks/use-message-templates';
import { useBankAccountInfos, useVoucherPriceInfos } from '@/hooks/useVoucherData';
import { api } from '@/lib/api/client';
import { MessageMaker } from './MessageMaker';
import type { SystemTemplate } from '@/features/system-templates/types';
import type { MessageTemplate } from '@/lib/template/types';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/hooks/useGetAuthUser', () => ({ useGetAuthUser: jest.fn() }));
jest.mock('@/features/system-templates/hooks/useSystemTemplates', () => ({ useSystemTemplates: jest.fn() }));
jest.mock('@/hooks/use-message-templates', () => ({ useMessageTemplates: jest.fn() }));
jest.mock('@/hooks/useVoucherData', () => ({ useBankAccountInfos: jest.fn(), useVoucherPriceInfos: jest.fn() }));
jest.mock('@/hooks/useClients', () => ({ useAllClients: () => { throw new Error('Customer queries forbidden in maker'); } }));
jest.mock('@/lib/api/client', () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));

const systemFixture = (key: string, name: string, content: string, group = 'mother', groupLabel = '서버 산모 그룹'): SystemTemplate => ({
  id: key, templateKey: key, name, content, group, groupLabel, description: '', createdAt: '', updatedAt: '',
  requiredVariables: [{ key: 'name', label: '성함', required: true, type: 'string' }], customVariables: [],
}) as SystemTemplate;
const fixtures = [
  systemFixture('CAREGIVER_SERVICE_START_NOTICE', '서버 제공인력 안내', '', 'provider', '서버 제공인력 그룹'),
  systemFixture('INFO', '서비스 내용', '안내 {{name}} {{link}}'),
  systemFixture('PRICE_INFO', '비용 안내', '{{name}} {{type}} {{duration}} {{fullPrice}} {{bankName}}'),
];
const query = <T,>(data: T) => ({ data, isLoading: false, isFetching: false, isError: false, isPlaceholderData: false, refetch: jest.fn().mockResolvedValue({ data, isError: false }) });
const mockSystem = jest.mocked(useSystemTemplates);
const mockUser = jest.mocked(useMessageTemplates);
const mockAuth = jest.mocked(useGetAuthUser);
let systemState: ReturnType<typeof query<SystemTemplate[]>>;
let userState: ReturnType<typeof query<MessageTemplate[]>>;
let branch = 'QA-branch-a';
const renderMaker = () => render(<MessageMaker data-component="mobile_messages-compose_page" />);
async function chooseTemplate(name: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox', { name: /템플릿 선택/ }));
  await user.click(await screen.findByRole('option', { name }));
}

describe('MessageMaker', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: () => false });
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: () => undefined });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value: () => undefined });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: () => undefined });
  });
  beforeEach(() => {
    jest.clearAllMocks(); branch = 'QA-branch-a';
    systemState = query(fixtures);
    userState = query([{ id: 'PRICE_INFO', name: '사용자 안내', content: '{{name}} {{note}}', variables: [{ key: 'name', label: '사용자 성함', type: 'text', required: false }, { key: 'note', label: '사용자 메모', type: 'text', required: true }], createdAt: '', updatedAt: '' }]);
    mockAuth.mockImplementation(() => query({ branchId: branch, role: 'owner' }) as unknown as ReturnType<typeof useGetAuthUser>);
    mockSystem.mockImplementation(() => systemState as unknown as ReturnType<typeof useSystemTemplates>);
    mockUser.mockImplementation(() => userState as unknown as ReturnType<typeof useMessageTemplates>);
    jest.mocked(useVoucherPriceInfos).mockReturnValue(query([]) as unknown as ReturnType<typeof useVoucherPriceInfos>);
    jest.mocked(useBankAccountInfos).mockReturnValue(query([]) as unknown as ReturnType<typeof useBankAccountInfos>);
  });
  it('defaults to maker and PRICE_INFO with plain name and no recipient or send effects', async () => {
    const { container } = renderMaker();
    await screen.findByLabelText('메시지 본문');
    expect(screen.getByRole('button', { name: '메세지 제작' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('combobox', { name: /템플릿 선택/ })).toHaveTextContent('비용 안내');
    const name = screen.getByRole('textbox', { name: /성함/ });
    expect(name.tagName).toBe('INPUT');
    fireEvent.change(name, { target: { value: 'QA-입력' } });
    expect((screen.getByLabelText('메시지 본문') as HTMLTextAreaElement).value).toContain('QA-입력');
    expect(screen.queryByLabelText(/휴대 전화번호|수신자/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /즉시 발송|예약 발송/ })).not.toBeInTheDocument();
    expect(container.querySelector('[data-source-component="ClientAutocomplete"]')).toBeNull();
    expect(api.get).not.toHaveBeenCalled(); expect(api.post).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled();
    const labels = [...container.querySelectorAll('[data-source-component="MakerField"] label')].map(label => label.textContent);
    expect(labels.indexOf('서비스 기간')).toBeLessThan(labels.indexOf('바우처 연도'));
    expect(labels.indexOf('바우처 연도')).toBeLessThan(labels.indexOf('지역'));
  });
  it('preserves server order and group labels and permits empty provider, user and custom templates', async () => {
    renderMaker(); await screen.findByLabelText('메시지 본문');
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: /템플릿 선택/ }));
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['서버 제공인력 안내', '서비스 내용', '비용 안내', '사용자 안내', '직접 작성']);
    expect(screen.getByText('서버 제공인력 그룹')).toHaveAttribute('data-slot', 'template-group-label');
    expect(document.querySelector('[data-slot="template-group-separator"]')).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: '서버 제공인력 안내' }));
    expect(screen.getByLabelText('메시지 본문')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('메시지 본문'), { target: { value: '빈 양식 편집' } });
    expect(screen.getByLabelText('메시지 본문')).toHaveValue('빈 양식 편집');
    await chooseTemplate('사용자 안내');
    expect(screen.getByRole('textbox', { name: /사용자 성함/ })).toHaveAttribute('aria-required', 'false');
    expect(screen.getByRole('textbox', { name: /사용자 메모/ })).toHaveAttribute('aria-required', 'true');
    await chooseTemplate('직접 작성');
    expect(screen.getByLabelText('메시지 본문')).toHaveValue('');
  });
  it('shows loading and stale catalog errors without an editable or copyable old body and retries', async () => {
    const view = renderMaker(); await screen.findByLabelText('메시지 본문');
    systemState = { ...systemState, isError: true };
    view.rerender(<MessageMaker data-component="mobile_messages-compose_page" />);
    expect(screen.getByRole('alert')).toHaveTextContent('템플릿을 불러오지 못했습니다');
    expect(screen.queryByLabelText('메시지 본문')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '복사' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '템플릿 다시 시도' }));
    await waitFor(() => expect(systemState.refetch).toHaveBeenCalledTimes(1));
    systemState = { ...systemState, isError: false, isLoading: true };
    view.rerender(<MessageMaker data-component="mobile_messages-compose_page" />);
    expect(screen.getByRole('status')).toHaveTextContent('템플릿을 불러오는 중');
    expect(screen.queryByLabelText('메시지 본문')).not.toBeInTheDocument();
    systemState = { ...systemState, isLoading: false };
    view.rerender(<MessageMaker data-component="mobile_messages-compose_page" />);
    expect(await screen.findByLabelText('메시지 본문')).toHaveValue(fixtures[2].content);
  });
  it('settles an empty catalog to direct composition and otherwise selects first server entry', async () => {
    systemState = query([]);
    const view = renderMaker();
    expect(await screen.findByLabelText('메시지 본문')).toHaveValue('');
    expect(screen.getByRole('combobox', { name: /템플릿 선택/ })).toHaveTextContent('직접 작성');
    branch = 'QA-branch-b'; systemState = query([fixtures[0], fixtures[1]]);
    view.rerender(<MessageMaker data-component="mobile_messages-compose_page" />);
    await screen.findByLabelText('메시지 본문');
    expect(screen.getByRole('combobox', { name: /템플릿 선택/ })).toHaveTextContent('서버 제공인력 안내');
  });
  it('clears the whole editing session on branch transition and waits for user-template revalidation', async () => {
    const view = renderMaker(); await screen.findByLabelText('메시지 본문');
    fireEvent.change(screen.getByLabelText('메시지 본문'), { target: { value: 'QA-이전 지점 본문' } });
    branch = 'QA-branch-b';
    let resolve!: (value: { isError: boolean }) => void;
    userState.refetch.mockImplementation(() => new Promise(done => { resolve = done; }));
    systemState = query([systemFixture('INFO', '새 지점 안내', '{{name}} 새 지점')]);
    view.rerender(<MessageMaker data-component="mobile_messages-compose_page" />);
    expect(screen.queryByLabelText('메시지 본문')).not.toBeInTheDocument();
    await waitFor(() => expect(userState.refetch).toHaveBeenCalledTimes(2));
    resolve({ isError: false });
    expect(await screen.findByLabelText('메시지 본문')).toHaveValue('{{name}} 새 지점');
    expect(screen.getByRole('textbox', { name: /성함/ })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: /템플릿 선택/ })).toHaveTextContent('새 지점 안내');
  });
});
