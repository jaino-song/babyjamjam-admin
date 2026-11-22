export type ErrorLogSummary = {
  name: string;
  message?: string;
  code?: string;
  status?: number;
  problemCode?: string;
};

const MAX_MESSAGE_LENGTH = 200;
const MAX_PROBLEM_CODE_LENGTH = 64;

// Read only explicitly allowed fields; hostile getters and proxies are untrusted.
function readField(value: unknown, key: string): unknown {
  try {
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)[key]
      : undefined;
  } catch {
    return undefined;
  }
}

export function summarizeErrorForLog(error: unknown): ErrorLogSummary {
  try {
    if (readField(error, "isAxiosError") === true) {
      const name = readField(error, "name");
      const summary: ErrorLogSummary = { name: typeof name === "string" ? name : "AxiosError" };
      const code = readField(error, "code");
      const response = readField(error, "response");
      const status = readField(response, "status");
      const problemCode = readField(readField(response, "data"), "code");

      if (typeof code === "string") summary.code = code;
      if (typeof status === "number" && Number.isFinite(status)) summary.status = status;
      if (
        typeof problemCode === "string"
        && problemCode.length <= MAX_PROBLEM_CODE_LENGTH
        && /^[A-Z0-9_]+$/.test(problemCode)
        && problemCode.trim() === problemCode
      ) {
        summary.problemCode = problemCode;
      }
      return summary;
    }

    if (error instanceof Error) {
      const name = readField(error, "name");
      const summary: ErrorLogSummary = { name: typeof name === "string" ? name : "Error" };
      // JSON parse errors may quote sensitive input in their message.
      if (summary.name !== "SyntaxError") {
        const message = readField(error, "message");
        if (typeof message === "string") summary.message = message.slice(0, MAX_MESSAGE_LENGTH);
      }
      return summary;
    }
  } catch {
    // Even instanceof can throw for a Proxy with a hostile getPrototypeOf trap.
  }
  return { name: "NonError" };
}
