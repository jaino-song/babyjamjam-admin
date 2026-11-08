import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { api } from "@/lib/api/client";
import { useEformsignBackupRuns, type EformsignBackupRun } from "../useEformsignBackupRuns";

jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn() } }));

it("reads backup run items from the staff proxy using a one-minute cache without polling", async () => {
  const items: EformsignBackupRun[] = [{
    id: "run-1", startedAt: "2026-11-09T18:00:00Z", finishedAt: "2026-11-09T18:10:00Z",
    status: "success", limited: false, totalDocs: 1, savedFiles: 2, skippedFiles: 0,
    failedFiles: 0, driveStatus: "ok", failures: [],
  }];
  (api.get as jest.Mock).mockResolvedValue({ data: { items } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result, unmount } = renderHook(() => useEformsignBackupRuns(), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(api.get).toHaveBeenCalledWith("/eformsign-backups/runs");
  expect(result.current.data?.items).toEqual(items);
  const query = client.getQueryCache().find({ queryKey: ["eformsign-backups", "runs"] });
  expect(query?.options).toMatchObject({ staleTime: 60_000 });
  expect(query?.options).not.toHaveProperty("refetchInterval");
  unmount();
  client.clear();
});
