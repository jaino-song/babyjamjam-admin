import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DocumentMilestoneFilterDialog } from '../DocumentMilestoneFilterDialog';
import { defaultDocumentScope, documentScopeSummary, type DocumentMilestoneScope } from '@/lib/eformsign-backup-view';

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

const base = 'desktop_contracts_sections_backup_manager_filter-dialog';
function setup(initial: DocumentMilestoneScope = defaultDocumentScope()) {
  const onApply = jest.fn();
  function Harness() {
    const [open, setOpen] = useState(true);
    const [scope, setScope] = useState(initial);
    return <>
      <button onClick={() => setOpen(true)}>필터 열기</button>
      <output aria-label="적용된 범위">{documentScopeSummary(scope)}</output>
      <DocumentMilestoneFilterDialog dataComponent={base} open={open} onOpenChange={setOpen} scope={scope} onApply={next => { onApply(next); setScope(next); }} />
    </>;
  }
  return { ...render(<Harness />), onApply };
}
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const toggle = (name: string) => fireEvent.click(screen.getByRole('checkbox', { name }));
const kind = (name: string) => fireEvent.click(screen.getByRole('radio', { name }));

describe('DocumentMilestoneFilterDialog', () => {
  it('renders accessible, scoped six/four groups and uses actual FormDialogShell ownership', () => {
    setup();
    const dialog = screen.getByRole('dialog', { name: '문서 필터' });
    expect(dialog).toHaveAttribute('data-component', base);
    expect(dialog).toHaveAttribute('data-source-component', 'FormDialogShell');
    expect(within(screen.getByRole('group', { name: '계약서 단계' })).getAllByRole('checkbox')).toHaveLength(7);
    expect(within(screen.getByRole('group', { name: '제공기록지 단계' })).getAllByRole('checkbox')).toHaveLength(5);
    expect(screen.getByLabelText('시작일')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('종료일')).toHaveAttribute('type', 'date');
    const form = dialog.querySelector('form')!;
    expect(form).toHaveAttribute('data-component', `${base}_content_form`);
    expect(form).toHaveAttribute('data-source-component', 'DocumentMilestoneFilterDialog');
    expect(screen.getByRole('button', { name: '적용' })).toHaveAttribute('form', form.id);
  });

  it('keeps edits private until Apply and uses an indeterminate group selection', async () => {
    const initial = defaultDocumentScope();
    const { onApply } = setup(initial);
    toggle('계약서 단계 이용자 문서 열람');
    expect(screen.getByRole('checkbox', { name: '계약서 단계 전체' })).toBePartiallyChecked();
    expect(initial.contractStages).toHaveLength(6);
    expect(screen.getByLabelText('적용된 범위')).toHaveTextContent('전체 기간 · 전체 종류 · 전체 단계');
    expect(onApply).not.toHaveBeenCalled();
    click('적용');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0].contractStages).not.toContain('opened');
    expect(screen.getByLabelText('적용된 범위')).toHaveTextContent('계약서 문서 생성');
    expect(initial.contractStages).toHaveLength(6);
  });

  it.each(['취소', 'Close', 'Escape'])('%s discards changes and reopening clones the applied value', async exit => {
    const { onApply } = setup();
    toggle('계약서 단계 문서 생성');
    if (exit === 'Escape') fireEvent.keyDown(document, { key: 'Escape' });
    else click(exit);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onApply).not.toHaveBeenCalled();
    click('필터 열기');
    expect(screen.getByRole('checkbox', { name: '계약서 단계 문서 생성' })).toBeChecked();
  });

  it('resets only the draft and Cancel retains the previous applied scope', async () => {
    const initial = { ...defaultDocumentScope(), kind: 'contract' as const, contractStages: ['signed'] as const };
    const { onApply } = setup({ ...initial, contractStages: [...initial.contractStages] });
    click('초기화');
    expect(screen.getByRole('radio', { name: '전체' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '계약서 단계 전체' })).toBeChecked();
    expect(screen.getByLabelText('적용된 범위')).toHaveTextContent('계약서 이용자 서명 완료');
    click('취소');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    click('필터 열기');
    expect(screen.getByRole('radio', { name: '계약서' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '계약서 단계 문서 생성' })).not.toBeChecked();
    click('초기화');
    click('적용');
    expect(onApply).toHaveBeenCalledWith(defaultDocumentScope());
  });

  it('hides irrelevant groups, preserves their choices, and validates only relevant kinds', () => {
    const { onApply } = setup();
    toggle('계약서 단계 전체');
    expect(screen.getByRole('alert')).toHaveTextContent('계약서 단계를 선택하세요');
    expect(screen.getByRole('button', { name: '적용' })).toBeDisabled();
    kind('제공기록지');
    expect(screen.queryByRole('group', { name: '계약서 단계' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '적용' })).toBeEnabled();
    kind('계약서');
    expect(screen.queryByRole('group', { name: '제공기록지 단계' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '계약서 단계 전체' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: '적용' })).toBeDisabled();
    kind('전체');
    toggle('제공기록지 단계 전체');
    expect(screen.getByText('제공기록지 단계를 선택하세요')).toBeInTheDocument();
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(onApply).not.toHaveBeenCalled();
    kind('제공기록지');
    toggle('제공기록지 단계 발송 완료');
    click('적용');
    expect(onApply.mock.calls[0][0]).toMatchObject({ kind: 'record', contractStages: [], recordStages: ['sent'] });
  });

  it('blocks reversed dates with an associated error and permits open bounds', () => {
    const { onApply } = setup();
    fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '2026-11-05' } });
    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-11-04' } });
    expect(screen.getByRole('button', { name: '적용' })).toBeDisabled();
    expect(screen.getByLabelText('시작일')).toHaveAccessibleDescription('시작일을 종료일 이전으로 선택하세요');
    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '' } });
    click('적용');
    expect(onApply.mock.calls[0][0]).toMatchObject({ period: 'custom', start: '2026-11-05', end: '' });
  });

  it('blocks an invalid calendar value supplied by a future caller', () => {
    setup({ ...defaultDocumentScope(), period: 'custom', start: '2026-02-30' });
    expect(screen.getByRole('alert')).toHaveTextContent('올바른 날짜를 입력하세요');
    expect(screen.getByRole('button', { name: '적용' })).toBeDisabled();
  });
});
