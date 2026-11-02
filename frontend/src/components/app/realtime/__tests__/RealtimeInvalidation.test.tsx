import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { UserProvider } from "@/providers/UserProvider";
import { RealtimeInvalidation } from "../RealtimeInvalidation";

class MockEventSource {
  static readonly OPEN = 1;
  static instances: MockEventSource[] = [];
  readyState = 0;
  closed = false;
  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }
  addEventListener() {}
  removeEventListener() {}
  close() {
    this.closed = true;
  }
}

const userIn = (branchId: string | null, id = "user-1") => ({ id, name: "직원", branchId });

describe("RealtimeInvalidation", () => {
  const queryClient = new QueryClient();

  const renderWith = (user: ReturnType<typeof userIn>) => (
    <QueryClientProvider client={queryClient}>
      <UserProvider user={user}>
        <RealtimeInvalidation />
      </UserProvider>
    </QueryClientProvider>
  );

  beforeEach(() => {
    MockEventSource.instances = [];
    (global as unknown as { EventSource: unknown }).EventSource = MockEventSource;
  });

  afterEach(() => {
    delete (global as unknown as { EventSource?: unknown }).EventSource;
  });

  it("switches the subscription when the layout hands down another branch", () => {
    const { rerender } = render(renderWith(userIn("branch-a")));
    expect(MockEventSource.instances).toHaveLength(1);

    rerender(renderWith(userIn("branch-b")));

    expect(MockEventSource.instances[0].closed).toBe(true);
    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[1].closed).toBe(false);
  });

  it("switches the subscription when a different user is handed down", () => {
    const { rerender } = render(renderWith(userIn("branch-a", "user-1")));
    rerender(renderWith(userIn("branch-a", "user-2")));

    expect(MockEventSource.instances[0].closed).toBe(true);
    expect(MockEventSource.instances).toHaveLength(2);
  });

  it("keeps one open subscription across re-renders with the same identity", () => {
    const { rerender } = render(renderWith(userIn("branch-a")));
    rerender(renderWith(userIn("branch-a")));

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].closed).toBe(false);
  });

  it("closes the subscription on unmount", () => {
    const { unmount } = render(renderWith(userIn("branch-a")));
    unmount();
    expect(MockEventSource.instances[0].closed).toBe(true);
  });
});
