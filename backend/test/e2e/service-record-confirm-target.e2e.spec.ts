import {
    assertApprovedServiceRecordConfirmDatabaseTarget,
    createApprovedServiceRecordConfirmClient,
    SERVICE_RECORD_CONFIRM_DATABASE,
} from "./helpers/service-record-confirm.helper";

describe("service-record confirmation disposable database guard", () => {
    it.each([
        "",
        "postgresql://postgres@127.0.0.1:5432/production",
        SERVICE_RECORD_CONFIRM_DATABASE.replace("task4", "task3"),
        SERVICE_RECORD_CONFIRM_DATABASE.replace("127.0.0.1", "localhost"),
        `${SERVICE_RECORD_CONFIRM_DATABASE}?schema=public`,
        SERVICE_RECORD_CONFIRM_DATABASE.replace("bjj_revision_test@", "bjj_revision_test:secret@"),
    ])("refuses unsafe or incomplete connection URLs before construction (%s)", (invalid) => {
        expect(() => assertApprovedServiceRecordConfirmDatabaseTarget(invalid, SERVICE_RECORD_CONFIRM_DATABASE)).toThrow();
        expect(() => createApprovedServiceRecordConfirmClient(SERVICE_RECORD_CONFIRM_DATABASE, invalid)).toThrow();
    });

    it("accepts only the exact pair of explicitly designated disposable URLs", () => {
        expect(() => assertApprovedServiceRecordConfirmDatabaseTarget(
            SERVICE_RECORD_CONFIRM_DATABASE,
            SERVICE_RECORD_CONFIRM_DATABASE,
        )).not.toThrow();
    });
});
