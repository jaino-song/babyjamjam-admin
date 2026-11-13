import { forwardRef, type AnchorHTMLAttributes } from 'react';

// Keep the real shell's anchor DOM/CSS, while all external navigation is inert.
export const PreviewLink = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }>(
  function PreviewLink({ href: _href, prefetch: _prefetch, onClick: _onClick, ...props }, ref) {
    return <a {...props} ref={ref} href="#" onClick={event => event.preventDefault()} />;
  },
);
export default PreviewLink;
