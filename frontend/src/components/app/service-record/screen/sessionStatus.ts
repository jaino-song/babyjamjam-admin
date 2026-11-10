import {
    DAY_STATUS_ADMIN_EDITED,
    DAY_STATUS_CHANGED,
    DAY_STATUS_DONE,
    DAY_STATUS_EDITABLE,
    DAY_STATUS_READONLY,
} from "./ids";

export interface AdminSessionStatusInput {
    pending: boolean;
    adminEdited: boolean;
    done: boolean;
    adminEditing: boolean;
}

export interface AdminSessionStatus {
    label: string;
    tone: "warning" | "success" | undefined;
}

/** Pending and confirmed admin edits stay visible even while the editor is locked. */
export function getAdminSessionStatus({ pending, adminEdited, done, adminEditing }: AdminSessionStatusInput): AdminSessionStatus {
    if (pending) return { label: DAY_STATUS_CHANGED, tone: "warning" };
    if (adminEdited) return { label: DAY_STATUS_ADMIN_EDITED, tone: "success" };
    return { label: done ? DAY_STATUS_DONE : adminEditing ? DAY_STATUS_EDITABLE : DAY_STATUS_READONLY, tone: undefined };
}
