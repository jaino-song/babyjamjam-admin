import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';

import {
  useResetTemplate,
  useRollbackTemplate,
  useTemplateVersions,
} from '../hooks';
import { VersionHistory } from './VersionHistory';

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
}));

jest.mock('../hooks', () => ({
  systemTemplateKeys: {
    global: {
      versionDetail: jest.fn(() => ['system-templates', 'version-detail']),
    },
    versionDetail: jest.fn(() => ['system-templates', 'version-detail']),
  },
  useTemplateVersions: jest.fn(),
  useRollbackTemplate: jest.fn(),
  useResetTemplate: jest.fn(),
}));

describe('VersionHistory', () => {
  const rollbackMutateAsync = jest.fn();
  const resetMutateAsync = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(useQuery).mockReturnValue({ data: undefined, isLoading: false } as never);
    jest.mocked(useTemplateVersions).mockReturnValue({
      data: [
        {
          versionNumber: 3,
          createdAt: '2026-07-11T00:00:00.000Z',
          createdBy: '관리자',
        },
      ],
      isLoading: false,
    } as never);
    jest.mocked(useRollbackTemplate).mockReturnValue({
      mutateAsync: rollbackMutateAsync,
      isPending: false,
    } as never);
    jest.mocked(useResetTemplate).mockReturnValue({
      mutateAsync: resetMutateAsync,
      isPending: false,
    } as never);
    rollbackMutateAsync.mockResolvedValue(undefined);
    resetMutateAsync.mockResolvedValue(undefined);
  });

  it('uses the shared approval modal before rolling back a version', async () => {
    render(<VersionHistory templateKey="greeting" />);

    fireEvent.click(screen.getByRole('button', { name: '버전 기록' }));
    fireEvent.click(screen.getByRole('button', { name: '이 버전으로 복원' }));

    const dialog = screen.getByRole('dialog', { name: '버전 복원' });
    expect(dialog).toHaveAttribute('data-component', 'desktop_system-templates_version-approval');
    expect(
      screen.getByText('버전 3으로 복원하시겠습니까? 현재 내용은 새 버전으로 저장됩니다.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '복원' }));

    await waitFor(() => {
      expect(rollbackMutateAsync).toHaveBeenCalledWith({
        key: 'greeting',
        versionNumber: 3,
      });
    });
  });

  it.each([
    { action: 'rollback', trigger: '이 버전으로 복원', idleLabel: '복원', pendingLabel: '복원 중' },
    { action: 'reset', trigger: '기본값으로 초기화', idleLabel: '초기화', pendingLabel: '초기화 중' },
  ])('shows a spinner while $action is pending and restores the idle action', ({ action, trigger, idleLabel, pendingLabel }) => {
    const mutation = { mutateAsync: action === 'rollback' ? rollbackMutateAsync : resetMutateAsync, isPending: false };
    jest.mocked(action === 'rollback' ? useRollbackTemplate : useResetTemplate)
      .mockReturnValue(mutation as never);
    const { rerender } = render(<VersionHistory templateKey="greeting" />);
    fireEvent.click(screen.getByRole('button', { name: '버전 기록' }));
    fireEvent.click(screen.getByRole('button', { name: trigger }));
    expect(screen.getByRole('button', { name: idleLabel })).toBeEnabled();

    mutation.isPending = true;
    rerender(<VersionHistory templateKey="greeting" />);

    const busyButton = screen.getByRole('button', { name: pendingLabel });
    expect(busyButton).toBeDisabled();
    expect(busyButton).toHaveAttribute('aria-busy', 'true');
    expect(busyButton).toHaveAttribute('data-loading', '');
    const idleContent = busyButton.querySelector('[data-slot="button-idle"]');
    expect(idleContent).toHaveAttribute('aria-hidden', 'true');
    expect(idleContent).toHaveClass('contents', 'invisible');
    expect(idleContent).toHaveTextContent(idleLabel);
    expect(busyButton.querySelector('[data-slot="button-spinner"] [data-slot="spinner"]'))
      .toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(pendingLabel)).toHaveClass('sr-only');
    expect(screen.getByRole('button', { name: '취소' })).toBeDisabled();
    fireEvent.click(busyButton);
    expect(mutation.mutateAsync).not.toHaveBeenCalled();

    mutation.isPending = false;
    rerender(<VersionHistory templateKey="greeting" />);
    const idleButton = screen.getByRole('button', { name: idleLabel });
    expect(idleButton).toBeEnabled();
    expect(idleButton).not.toHaveAttribute('aria-busy');
    expect(idleButton).not.toHaveAttribute('data-loading');
    expect(idleButton.querySelector('[data-slot="button-spinner"]')).toBeNull();
  });

  it.each(['history', 'preview'])('renders an accessible spinner without visible loading copy for the %s', (view) => {
    if (view === 'history') {
      jest.mocked(useTemplateVersions).mockReturnValue({ data: undefined, isLoading: true } as never);
    } else {
      jest.mocked(useQuery).mockReturnValue({ data: undefined, isLoading: true } as never);
    }
    render(<VersionHistory templateKey="greeting" />);
    fireEvent.click(screen.getByRole('button', { name: '버전 기록' }));
    if (view === 'preview') {
      fireEvent.click(screen.getByRole('button', { name: '미리보기' }));
    }

    const label = view === 'history' ? '버전 기록을 불러오는 중' : '버전 미리보기를 불러오는 중';
    const status = screen.getByRole('status', { name: label });
    expect(status).toHaveAttribute('data-slot', 'loading-state');
    expect(status).toHaveAttribute('data-source-component', 'LoadingState');
    expect(status.querySelector('[data-slot="spinner"]')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(label)).toHaveClass('sr-only');
  });

  it('keeps version icon actions at 32px with a 44px touch area', () => {
    render(<VersionHistory templateKey="greeting" />);
    fireEvent.click(screen.getByRole('button', { name: '버전 기록' }));

    for (const name of ['미리보기', '이 버전으로 복원']) {
      const button = screen.getByRole('button', { name });
      expect(button).toHaveAttribute('data-size', 'icon');
      expect(button).toHaveClass(
        'h-[calc(32px*var(--glint-ui-scale,1))]',
        'w-[calc(32px*var(--glint-ui-scale,1))]',
        'relative',
        'after:absolute',
        'after:h-[calc(44px*var(--glint-ui-scale,1))]',
        'after:w-[calc(44px*var(--glint-ui-scale,1))]',
      );
    }
  });

  it('uses the destructive approval action before resetting to defaults', async () => {
    render(<VersionHistory templateKey="greeting" />);

    fireEvent.click(screen.getByRole('button', { name: '버전 기록' }));
    fireEvent.click(screen.getByRole('button', { name: '기본값으로 초기화' }));

    const dialog = screen.getByRole('dialog', { name: '기본값 초기화' });
    expect(dialog).toHaveAttribute('data-component', 'desktop_system-templates_version-approval');
    expect(screen.getByRole('button', { name: '초기화' })).toHaveAttribute(
      'data-variant',
      'destructive',
    );

    fireEvent.click(screen.getByRole('button', { name: '초기화' }));

    await waitFor(() => {
      expect(resetMutateAsync).toHaveBeenCalledWith('greeting');
    });
  });
});
