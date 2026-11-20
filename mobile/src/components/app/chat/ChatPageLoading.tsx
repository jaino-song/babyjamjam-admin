import { Spinner } from "@/components/ui/spinner";

export function ChatPageLoading() {
  return (
    <section className="flex flex-1 items-center justify-center" data-component="mobile_chat_agent-shell_loading" role="status" aria-live="polite">
      <Spinner size="sm" aria-hidden="true" />
      <span className="sr-only">대화를 준비하고 있습니다.</span>
    </section>
  );
}
