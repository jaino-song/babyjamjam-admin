export type StartDateChangeMode = "CONFIRM_STARTED" | "RESTART" | "MOVE";

export const START_DATE_CHANGE_MODES = ["CONFIRM_STARTED", "RESTART", "MOVE"] as const;

export function isStartDateChangeMode(value: unknown): value is StartDateChangeMode {
    return typeof value === "string" && (START_DATE_CHANGE_MODES as readonly string[]).includes(value);
}
