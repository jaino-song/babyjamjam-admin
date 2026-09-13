import { act } from '@testing-library/react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server.node';
import { useActiveBranchId } from './branch-context';

function BranchContextProbe() {
  const branchId = useActiveBranchId();
  return <span>{branchId ?? 'pending'}</span>;
}

it('hydrates with the server context before showing the selected branch', async () => {
  document.cookie = 'selected_branch_id=branch-a; path=/';
  const container = document.createElement('div');
  container.innerHTML = renderToString(<BranchContextProbe />);
  expect(container.textContent).toBe('pending');
  document.body.appendChild(container);
  const onRecoverableError = jest.fn();
  let root: Root | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(container, <BranchContextProbe />, { onRecoverableError });
    });
    expect(container.textContent).toBe('branch-a');
    expect(onRecoverableError).not.toHaveBeenCalled();
    document.cookie = 'selected_branch_id=branch-b; path=/';
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(container.textContent).toBe('branch-b');
  } finally {
    await act(async () => root?.unmount());
    container.remove();
    document.cookie = 'selected_branch_id=; Max-Age=0; path=/';
  }
});
