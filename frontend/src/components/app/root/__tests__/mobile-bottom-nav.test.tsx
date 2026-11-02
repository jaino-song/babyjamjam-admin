import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { MobileBottomNav } from '../mobile-bottom-nav';

const mockUsePathname = jest.fn();

jest.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}));

// jsdom does not apply Tailwind, so the visual rule (the nav is display:none
// while a modal layer is open) is asserted through its two halves:
//  1. the nav carries the class that hides it under `body[data-scroll-locked]`
//  2. a real Radix Sheet sets that exact body attribute while open and clears it on close
// The rendered overlap itself is checked in a browser (see the PR notes).
const HIDE_WHILE_MODAL_OPEN = '[body[data-scroll-locked]_&]:hidden';

describe('MobileBottomNav', () => {
  beforeEach(() => {
    mockUsePathname.mockReturnValue('/contracts');
  });

  it('renders nothing on layout-excluded routes', () => {
    mockUsePathname.mockReturnValue('/login');
    const { container } = render(<MobileBottomNav />);

    expect(container).toBeEmptyDOMElement();
  });

  it('keeps its mobile-only fixed placement', () => {
    render(<MobileBottomNav />);

    const nav = screen.getByRole('navigation');
    expect(nav).toHaveAttribute('data-component', 'desktop_chrome_mobile-bottom-nav');
    expect(nav).toHaveClass('fixed', 'bottom-4', 'z-[1000]', 'md:hidden');
  });

  it('is hidden while a modal layer holds the body scroll lock', () => {
    render(<MobileBottomNav />);

    expect(screen.getByRole('navigation')).toHaveClass(HIDE_WHILE_MODAL_OPEN);
  });

  it('is matched by the scroll-lock selector exactly while a real Sheet is open', async () => {
    render(
      <>
        <MobileBottomNav />
        <Sheet>
          <SheetTrigger>open sheet</SheetTrigger>
          <SheetContent side="bottom">
            <SheetHeader>
              <SheetTitle>jobs</SheetTitle>
              <SheetDescription>jobs list</SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>
      </>
    );
    const navSelector = 'body[data-scroll-locked] [data-component="desktop_chrome_mobile-bottom-nav"]';

    expect(document.querySelector(navSelector)).toBeNull();

    fireEvent.click(screen.getByText('open sheet'));
    expect(await screen.findByText('jobs list')).toBeInTheDocument();
    expect(document.body).toHaveAttribute('data-scroll-locked');
    expect(document.querySelector(navSelector)).not.toBeNull();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(document.body).not.toHaveAttribute('data-scroll-locked'));
    expect(document.querySelector(navSelector)).toBeNull();
  });
});
