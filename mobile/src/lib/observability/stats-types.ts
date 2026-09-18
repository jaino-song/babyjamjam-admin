export type SentryLevel = "fatal" | "error" | "warning" | "info";

export interface SentryIssue {
  id: string;
  title: string;
  level: SentryLevel;
  count: number;
  userCount: number;
  lastSeen: string;
  firstSeen: string;
  permalink: string;
  culprit: string | null;
  filename: string | null;
  function: string | null;
}
