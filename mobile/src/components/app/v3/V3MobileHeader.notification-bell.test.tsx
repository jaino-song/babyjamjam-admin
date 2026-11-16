import { render, screen } from '@testing-library/react';

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
