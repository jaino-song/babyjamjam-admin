export type StartDateChangeMode = "CONFIRM_STARTED" | "RESTART" | "MOVE";
export declare const START_DATE_CHANGE_MODES: readonly ["CONFIRM_STARTED", "RESTART", "MOVE"];
export declare function isStartDateChangeMode(value: unknown): value is StartDateChangeMode;
