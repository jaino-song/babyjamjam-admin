import { render, screen } from '@testing-library/react';
import { V3MobileHeader } from '../V3MobileHeader';

const mockUsePathname = jest.fn();

jest.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}));
jest.mock('@/components/app/notifications/NotificationBell', () => ({
  NotificationBell: () => null,
}));

describe('V3MobileHeader', () => {
  it('is hidden while a modal layer holds the body scroll lock (it sits above every sheet at z-[1000])', () => {
    mockUsePathname.mockReturnValue('/contracts');
    const { container } = render(<V3MobileHeader />);

    const header = container.querySelector('[data-component="desktop_chrome_mobile-header"]');
    expect(header).toHaveClass('fixed', 'z-[1000]', 'md:hidden', '[body[data-scroll-locked]_&]:hidden');
    expect(screen.getByText('아가잼잼')).toBeInTheDocument();
  });
});
