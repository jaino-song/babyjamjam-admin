import { fireEvent, render, screen } from '@testing-library/react';

import { VersionHistory } from './VersionHistory';

jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false }),
}));

jest.mock('../hooks', () => ({
  systemTemplateKeys: { versionDetail: jest.fn() },
  useTemplateVersions: () => ({ data: [], isLoading: false }),
  useRollbackTemplate: () => ({ isPending: false, mutateAsync: jest.fn() }),
  useResetTemplate: () => ({ isPending: false, mutateAsync: jest.fn() }),
}));

describe('VersionHistory title alignment', () => {
  it('centers the version history sheet title without changing its accessible name', () => {
    render(<VersionHistory templateKey="test-template" />);
    fireEvent.click(screen.getByRole('button', { name: '버전 기록' }));

    const title = screen.getByRole('heading', { name: '버전 기록' });
    expect(title).toHaveClass('text-center');
    expect(title).not.toHaveClass('text-left');
    expect(title.parentElement).toHaveClass('text-center');
    expect(screen.getByRole('dialog', { name: '버전 기록' })).toBeInTheDocument();
  });
});
