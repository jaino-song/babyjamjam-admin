import { fireEvent, render, screen } from '@testing-library/react';
import { PaneHeader } from '../PaneHeader';

test.each(['default', 'compact'] as const)('aligns both variants with %s insets and renders actions', inset => {
  const back = jest.fn();
  const { container, rerender } = render(<PaneHeader variant="title" title="전자문서 작업" inset={inset} actions={<button>닫기</button>} data-component="desktop_contracts_jobs_header" />);
  expect(screen.getByText('전자문서 작업')).toBeInTheDocument();
  const header = container.firstElementChild;
  expect(header).toHaveClass('min-h-[calc(56px*var(--glint-ui-scale,1))]', 'py-[calc(12px*var(--glint-ui-scale,1))]', inset === 'compact' ? 'px-5' : 'px-6');
  expect(screen.getByRole('button', { name: '닫기' }).parentElement).toHaveAttribute('data-slot', 'pane-header-actions');
  rerender(<PaneHeader variant="back" backLabel="목록으로 돌아가기" onBack={back} inset={inset} />);
  expect(header).toHaveClass(inset === 'compact' ? 'px-5' : 'px-6');
  fireEvent.click(screen.getByRole('button', { name: '목록으로 돌아가기' }));
  expect(back).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[data-slot="pane-header-actions"]')).toBeNull();
});
