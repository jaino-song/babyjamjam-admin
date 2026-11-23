import { PROBLEM_CATALOG, type ProblemCode } from "./problem-details";

const ERROR_NAMES = [
  "Error", "AggregateError", "EvalError", "RangeError",
  "ReferenceError", "SyntaxError", "TypeError", "URIError",
] as const;

const TRANSPORT_CODES = [
  "ECONNABORTED", "ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH",
  "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN",
  "ERR_BAD_OPTION_VALUE", "ERR_BAD_OPTION", "ERR_NETWORK",
  "ERR_FR_TOO_MANY_REDIRECTS", "ERR_DEPRECATED", "ERR_BAD_RESPONSE",
  "ERR_BAD_REQUEST", "ERR_CANCELED", "ERR_NOT_SUPPORT", "ERR_INVALID_URL",
] as const;

export type ErrorLogSummary = {
  name: (typeof ERROR_NAMES)[number] | "AxiosError" | "NonError";
  code?: (typeof TRANSPORT_CODES)[number];
  status?: number;
  problemCode?: ProblemCode;
};

function readField(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function catalogCode(code: unknown): ProblemCode | undefined {
  if (typeof code === "string" && Object.prototype.hasOwnProperty.call(PROBLEM_CATALOG, code)) {
    return PROBLEM_CATALOG[code as ProblemCode].code;
  }
  return undefined;
}

export function summarizeErrorForLog(error: unknown): ErrorLogSummary {
  try {
    if (readField(error, "isAxiosError") === true) {
      const summary: ErrorLogSummary = { name: "AxiosError" };
      const code = readField(error, "code");
      const transportCode = TRANSPORT_CODES.find(known => known === code);
      const response = readField(error, "response");
      const status = readField(response, "status");
      const problemCode = catalogCode(readField(readField(response, "data"), "code"));

      if (transportCode) summary.code = transportCode;
      if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) {
        summary.status = status;
      }
      if (problemCode) summary.problemCode = problemCode;
      return summary;
    }

    if (error instanceof Error) {
      const name = readField(error, "name");
      return { name: ERROR_NAMES.find(known => known === name) ?? "Error" };
    }
  } catch {
    // Accessors and proxy traps can throw. Discard the partial summary.
  }
  return { name: "NonError" };
}
