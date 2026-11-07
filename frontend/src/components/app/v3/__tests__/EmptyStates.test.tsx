import { render, screen } from '@testing-library/react';
import { ListEmptyState } from '../ListEmptyState';
import { DetailEmptyState } from '../DetailEmptyState';

const base = 'desktop_contracts_sections_backup_manager_empty';

it.each([['ListEmptyState', ListEmptyState], ['DetailEmptyState', DetailEmptyState]] as const)('%s forwards the full caller prefix and its actual source owner', (name, Component) => {
  const { container } = render(<Component data-component={base} message="연결 전" action={<span>작업</span>} />);
  const root = container.firstElementChild!;
  expect(root).toHaveAttribute('data-component', base);
  expect(root).toHaveAttribute('data-source-component', name);
  expect(root).toHaveAttribute('data-slot', 'list-empty-state');
  expect(screen.getByText('연결 전').parentElement).toHaveAttribute('data-component', `${base}_copy`);
  expect(screen.getByText('작업').parentElement).toHaveAttribute('data-component', `${base}_copy_action`);
  expect(screen.getByText('작업').parentElement).toHaveAttribute('data-slot', 'empty-state-action');
});

it.each([ListEmptyState, DetailEmptyState])('retains legacy annotations and wrapper count without a caller prefix', Component => {
  const { container } = render(<Component message="기존 빈 상태" action={<span>기존 작업</span>} />);
  expect(container.children).toHaveLength(1);
  expect(container.firstElementChild).not.toHaveAttribute('data-component');
  expect(screen.getByText('기존 빈 상태').parentElement).toHaveAttribute('data-component', 'desktop_v3_list-empty-state_copy');
  expect(screen.getByText('기존 작업').parentElement).toHaveAttribute('data-component', 'desktop_v3_list-empty-state_copy_action');
});
