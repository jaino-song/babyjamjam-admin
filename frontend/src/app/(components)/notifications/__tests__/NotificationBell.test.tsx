import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NotificationBell } from '../NotificationBell';
import type { Notification } from '@/app/hooks/usePushNotification';

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('../FilteredClientsDialog', () => ({
  FilteredClientsDialog: () => null,
}));

const mockMarkAsReadMutate = jest.fn();
const mockMarkAllAsReadMutate = jest.fn();
let mockNotifications: Notification[] = [];
let mockUnreadCount = 3;

const mockUnreadNotificationWithUrl: Notification = {
  id: 1,
  title: '새 메시지가 도착했습니다',
  body: '홍길동님이 메시지를 보냈습니다',
  data: { url: '/clients/123' },
  sentAt: new Date().toISOString(),
  readAt: null,
  isRead: false,
};

const mockReadNotificationWithUrl: Notification = {
  id: 2,
  title: '읽은 알림',
  body: '이미 확인한 알림입니다',
  data: { url: '/employees/456' },
  sentAt: new Date().toISOString(),
  readAt: new Date().toISOString(),
  isRead: true,
};

const mockNotificationWithoutUrl: Notification = {
  id: 3,
  title: 'URL 없는 알림',
  body: '이동할 페이지가 없습니다',
  data: null,
  sentAt: new Date().toISOString(),
  readAt: null,
  isRead: false,
};

const mockNotificationWithDataButNoUrl: Notification = {
  id: 4,
  title: 'Data without URL',
  body: 'Has data object but no url property',
  data: { otherProp: 'value' },
  sentAt: new Date().toISOString(),
  readAt: null,
  isRead: false,
};

const mockFilteredNotification: Notification = {
  id: 5,
  title: '서비스 시작 예정',
  body: '일주일 내로 시작되는 서비스 3건을 확인해 보세요',
  data: { url: '/clients/filtered?filter=starting-soon' },
  sentAt: new Date().toISOString(),
  readAt: null,
  isRead: false,
};

const mockIndividualClientNotification: Notification = {
  id: 6,
  title: '계약서 미발송',
  body: '홍길동 님에게 계약서가 발송되지 않았습니다',
  data: { url: '/clients?id=123' },
  sentAt: new Date().toISOString(),
  readAt: null,
  isRead: false,
};

jest.mock('@/app/hooks/usePushNotification', () => ({
  useMarkAsRead: () => ({ mutate: mockMarkAsReadMutate }),
  useMarkAllAsRead: () => ({ mutate: mockMarkAllAsReadMutate, isPending: false }),
  useUnreadCount: () => ({ data: mockUnreadCount }),
  useNotifications: () => ({ data: mockNotifications, isLoading: false }),
  usePushNotification: () => ({
    isSupported: true,
    isSubscribed: true,
    permission: 'granted',
    isLoading: false,
    error: null,
    subscribe: jest.fn(),
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockNotifications = [mockUnreadNotificationWithUrl];
  mockUnreadCount = 3;
});

describe('NotificationBell', () => {
  it('should call markAsRead.mutate when clicking unread notification', async () => {
    render(<NotificationBell />);

    fireEvent.click(screen.getByTestId('notification-bell'));

    await waitFor(() => {
      expect(screen.getByTestId('notification-popover')).toBeVisible();
    });

    fireEvent.click(screen.getByTestId('notification-item-unread'));

    expect(mockMarkAsReadMutate).toHaveBeenCalledWith(1);
    expect(mockMarkAsReadMutate).toHaveBeenCalledTimes(1);
  });

  it('should NOT call markAsRead.mutate when clicking already-read notification', async () => {
    mockNotifications = [mockReadNotificationWithUrl];

    render(<NotificationBell />);

    fireEvent.click(screen.getByTestId('notification-bell'));

    await waitFor(() => {
      expect(screen.getByTestId('notification-popover')).toBeVisible();
    });

    fireEvent.click(screen.getByTestId('notification-item'));

    expect(mockMarkAsReadMutate).not.toHaveBeenCalled();
  });

  it('should call router.push with notification URL', async () => {
    render(<NotificationBell />);

    fireEvent.click(screen.getByTestId('notification-bell'));

    await waitFor(() => {
      expect(screen.getByTestId('notification-popover')).toBeVisible();
    });

    fireEvent.click(screen.getByTestId('notification-item-unread'));

    expect(mockPush).toHaveBeenCalledWith('/clients/123');
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('should NOT call router.push when notification has no URL', async () => {
    mockNotifications = [mockNotificationWithoutUrl];

    render(<NotificationBell />);

    fireEvent.click(screen.getByTestId('notification-bell'));

    await waitFor(() => {
      expect(screen.getByTestId('notification-popover')).toBeVisible();
    });

    fireEvent.click(screen.getByTestId('notification-item-unread'));

    expect(mockPush).not.toHaveBeenCalled();
  });

  it('should close popover before navigation (verify via DOM)', async () => {
    render(<NotificationBell />);

    fireEvent.click(screen.getByTestId('notification-bell'));

    await waitFor(() => {
      expect(screen.getByTestId('notification-popover')).toBeVisible();
    });

    fireEvent.click(screen.getByTestId('notification-item-unread'));

    await waitFor(() => {
      expect(screen.queryByTestId('notification-popover')).not.toBeInTheDocument();
    });

    expect(mockPush).toHaveBeenCalled();
  });

  it('should NOT call window.location.href (regression prevention)', async () => {
    const originalLocation = window.location;
    const hrefSetter = jest.fn();

    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, href: '' },
      writable: true,
      configurable: true,
    });

    Object.defineProperty(window.location, 'href', {
      set: hrefSetter,
      configurable: true,
    });

    render(<NotificationBell />);

    fireEvent.click(screen.getByTestId('notification-bell'));

    await waitFor(() => {
      expect(screen.getByTestId('notification-popover')).toBeVisible();
    });

    fireEvent.click(screen.getByTestId('notification-item-unread'));

    expect(hrefSetter).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalled();

    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  it('should handle notification.data without url property', async () => {
    mockNotifications = [mockNotificationWithDataButNoUrl];

    render(<NotificationBell />);

    fireEvent.click(screen.getByTestId('notification-bell'));

    await waitFor(() => {
      expect(screen.getByTestId('notification-popover')).toBeVisible();
    });

    fireEvent.click(screen.getByTestId('notification-item-unread'));

    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should NOT call router.push when clicking filtered notification URL', async () => {
    mockNotifications = [mockFilteredNotification];

    render(<NotificationBell />);

    fireEvent.click(screen.getByTestId('notification-bell'));

    await waitFor(() => {
      expect(screen.getByTestId('notification-popover')).toBeVisible();
    });

    fireEvent.click(screen.getByTestId('notification-item-unread'));

    expect(mockPush).not.toHaveBeenCalled();
  });

  it('should NOT call router.push when clicking individual client notification URL', async () => {
    mockNotifications = [mockIndividualClientNotification];

    render(<NotificationBell />);

    fireEvent.click(screen.getByTestId('notification-bell'));

    await waitFor(() => {
      expect(screen.getByTestId('notification-popover')).toBeVisible();
    });

    fireEvent.click(screen.getByTestId('notification-item-unread'));

    expect(mockPush).not.toHaveBeenCalled();
  });
});
