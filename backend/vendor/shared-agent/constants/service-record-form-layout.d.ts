export type ServiceRecordFieldKind = "multi" | "radio" | "counts" | "text" | "check";
export type ServiceRecordFieldSource = "answers" | "session";
export interface ServiceRecordCountSubKey {
    key: string;
    label: string;
    unit: string;
}
export interface ServiceRecordFieldDescriptor {
    key: string;
    label: string;
    kind: ServiceRecordFieldKind;
    source?: ServiceRecordFieldSource;
    options?: string[];
    subKeys?: ServiceRecordCountSubKey[];
    normalValues?: string[];
}
export interface ServiceRecordFormSection {
    id: "mom" | "baby" | "finish";
    title: string;
    tone: "mom" | "baby" | "finish";
    fields: ServiceRecordFieldDescriptor[];
}
export declare const SERVICE_RECORD_FORM_LAYOUT: ServiceRecordFormSection[];
export declare const SERVICE_RECORD_LAYOUT_ANSWER_KEYS: Set<string>;
