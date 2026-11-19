import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Notification boundary adapter: same actual Button/icon as NotificationBell's
// subscribed presentation, without mounting its notification/auth/data tree.
export function PreviewNotificationAdapter({ 'data-component': base, className }: {
  'data-component'?: string; className?: string;
}): React.JSX.Element {
  return <Button type="button" variant="ghost" size="icon" aria-label="알림 열기 (미리보기)"
    data-component={base} data-source-component="PreviewNotificationAdapter"
    className={cn('relative transition-transform duration-200 hover:scale-110 active:scale-95', className)}>
    <Bell className="!h-5 !w-5 text-primary" />
  </Button>;
}

export { PreviewNotificationAdapter as NotificationBell };
