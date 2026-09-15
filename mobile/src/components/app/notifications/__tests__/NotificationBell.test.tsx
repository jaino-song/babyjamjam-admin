import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NotificationBell } from '../NotificationBell';
import type { Notification } from '@/hooks/usePushNotification';

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('../FilteredClientsDialog', () => ({
  FilteredClientsDialog: () => null,
}));

const mockMarkAsReadMutate = jest.fn();
const mockMarkAllAsReadMutate = jest.fn();
let mockNotifications: Notification[] | undefined = [];
let mockNotificationsIsError = false;
let mockNotificationsError: unknown = null;
const mockNotificationsRefetch = jest.fn();
let mockUnreadCount: number | undefined = 3;
let mockUnreadCountIsError = false;
let mockUnreadCountError: unknown = null;
const mockUnreadCountRefetch = jest.fn();

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

jest.mock('@/hooks/usePushNotification', () => ({
  useMarkAsRead: () => ({ mutate: mockMarkAsReadMutate }),
  useMarkAllAsRead: () => ({ mutate: mockMarkAllAsReadMutate, isPending: false }),
  useUnreadCount: () => ({
    data: mockUnreadCount,
    isError: mockUnreadCountIsError,
    error: mockUnreadCountError,
    refetch: mockUnreadCountRefetch,
    isFetching: false,
  }),
  useNotifications: () => ({
    data: mockNotifications,
    isLoading: false,
    isError: mockNotificationsIsError,
    error: mockNotificationsError,
    refetch: mockNotificationsRefetch,
    isFetching: false,
  }),
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
  mockNotificationsIsError = false;
  mockNotificationsError = null;
  mockUnreadCount = 3;
  mockUnreadCountIsError = false;
  mockUnreadCountError = null;
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

  it('shows an initial notification read failure with an explicit retry', async () => {
    mockNotifications = undefined;
    mockNotificationsIsError = true;
    mockNotificationsError = new Error('server detail must not be shown');

    render(<NotificationBell />);

    fireEvent.click(screen.getByTestId('notification-bell'));

    await waitFor(() => {
      expect(screen.getByText('알림을 불러오지 못했어요')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));

    expect(mockNotificationsRefetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('server detail must not be shown')).not.toBeInTheDocument();
  });

  it('keeps stale notifications visible while showing a refresh warning', async () => {
    mockNotificationsIsError = true;
    mockNotificationsError = new Error('server detail must not be shown');

    render(<NotificationBell />);

    fireEvent.click(screen.getByTestId('notification-bell'));

    await waitFor(() => {
      expect(screen.getByTestId('notification-item-unread')).toBeInTheDocument();
      expect(screen.getByText('알림 목록을 새로 불러오지 못했어요')).toBeInTheDocument();
    });
  });

  it('does not show an unread badge when the count read fails', async () => {
    mockUnreadCount = undefined;
    mockUnreadCountIsError = true;
    mockUnreadCountError = new Error('server detail must not be shown');

    render(<NotificationBell />);

    expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('notification-bell'));

    await waitFor(() => {
      expect(screen.getByText('읽지 않은 알림 수를 새로 불러오지 못했어요')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));

    expect(mockUnreadCountRefetch).toHaveBeenCalledTimes(1);
  });
});
