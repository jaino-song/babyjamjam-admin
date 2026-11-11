import '@/app/globals.css';
import '@/components/app/mobile-redesign/redesign.css';
import { createRoot } from 'react-dom/client';
import { V3MobileHeader } from '@/components/app/v3/V3MobileHeader';
import { V3MainContent } from '@/components/app/v3/V3MainContent';
import { MobileBottomNav } from '@/components/app/root/mobile-bottom-nav';
import { MessageCompletePreview } from './MessageCompletePreview';

const root = document.getElementById('root');
if (!root) throw new Error('Preview root missing');
createRoot(root).render(
  <div data-component="mobile_shell_root" data-slot="app-root"
    className="mobile-app-root relative h-[100dvh] w-[100vw] max-w-none overflow-hidden [--mobile-shell-max-height:100dvh]">
    <div data-component="mobile_shell_root_app-shell" data-slot="app-shell" className="relative h-full min-h-0 w-full overflow-hidden">
      <div data-component="mobile_shell_root_app-shell_providers" data-slot="app-content" className="relative h-full min-h-0 w-full overflow-hidden">
        <V3MobileHeader data-component="mobile_shell_header" />
        <V3MainContent data-component="mobile_shell_main-content"><MessageCompletePreview /></V3MainContent>
        <MobileBottomNav />
      </div>
    </div>
  </div>,
);
