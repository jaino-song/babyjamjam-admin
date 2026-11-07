"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";

export type EformsignBackupRun = {
  id: string;
  startedAt: string;
  finishedAt: string;
  status: "success" | "partial" | "failed";
  limited: boolean;
  totalDocs: number;
  savedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  driveStatus: "ok" | "failed" | "skipped";
  failures: { docId: string; reason: string }[];
};

async function fetchEformsignBackupRuns(): Promise<{ items: EformsignBackupRun[] }> {
  const { data } = await api.get<{ items: EformsignBackupRun[] }>(
    "/eformsign-backups/runs",
  );
  return data;
}

export function useEformsignBackupRuns() {
  return useQuery({
    queryKey: ["eformsign-backups", "runs"],
    queryFn: fetchEformsignBackupRuns,
    staleTime: 60_000,
  });
}
