import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { V3MobileHeader } from './V3MobileHeader';

jest.mock('next/navigation', () => ({
  usePathname: () => '/clients',
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('@/providers/UserProvider', () => ({ useInitialUser: () => ({ name: 'QA-user', branchName: '개발QA점' }) }));
jest.mock('@/hooks/usePushNotification', () => ({
  usePushNotification: () => ({ isSupported: true, isSubscribed: true, permission: 'granted', subscribe: jest.fn() }),
  useUnreadCount: () => ({ data: 0 }),
  useNotifications: () => ({ data: [], isLoading: false }),
  useMarkAsRead: () => ({ mutate: jest.fn() }),
  useMarkAllAsRead: () => ({ mutate: jest.fn() }),
}));
jest.mock('@/components/app/notifications/FilteredClientsDialog', () => ({ FilteredClientsDialog: () => null }));

it('keeps the real shell notification bell at 32px with a 44px touch area', () => {
  render(<V3MobileHeader data-component="mobile_shell_header" />);
  const bell = screen.getByRole('button', { name: '알림 열기' });
  expect(bell).toHaveAttribute('data-component', 'mobile_shell_header_icons_notification-bell');
  expect(bell).toHaveClass('!rounded-xl');
  expect(bell).toHaveClass('h-8');
  expect(bell).toHaveClass('w-8');
  expect(bell).toHaveClass('relative');
  expect(bell).toHaveClass('after:absolute');
  expect(bell).toHaveClass('after:-inset-1.5');
  expect(bell).toHaveClass("after:content-['']");
  expect(bell).not.toHaveClass('!h-[44px]');
  expect(bell).not.toHaveClass('!w-[44px]');
});

it('retains the same real notification bell in the embedded agent header', () => {
  render(<V3MobileHeader
    data-component="mobile_chat_agent-shell_header"
    data-slot="agent-header"
    embedded
    trailingSlot={<button aria-label="새 대화" />}
  />);
  const bell = screen.getByRole('button', { name: '알림 열기' });
  expect(bell).toHaveAttribute('data-component', 'mobile_chat_agent-shell_header_icons_notification-bell');
  expect(bell).toHaveClass('h-8', 'w-8', 'relative', 'after:absolute', 'after:-inset-1.5', "after:content-['']");
  expect(screen.getAllByRole('button')).toEqual([screen.getByRole('button', { name: '새 대화' }), bell]);
});

it('blocks the real notification popover while notifications are disabled and restores it afterwards', async () => {
  const user = userEvent.setup();
  const { rerender } = render(<V3MobileHeader data-component="mobile_chat_agent-shell_header" embedded notificationsDisabled />);
  const bell = screen.getByRole('button', { name: '알림 열기' });
  expect(bell).toBeDisabled();
  await user.click(bell);
  await user.tab();
  expect(bell).not.toHaveFocus();
  expect(screen.queryByTestId('notification-popover')).not.toBeInTheDocument();

  rerender(<V3MobileHeader data-component="mobile_chat_agent-shell_header" embedded />);
  expect(bell).toBeEnabled();
  await user.click(bell);
  expect(screen.getByTestId('notification-popover')).toBeInTheDocument();
});
