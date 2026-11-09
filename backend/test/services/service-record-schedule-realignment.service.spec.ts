import type { Prisma } from "@prisma/client";

import { parsePlannedVector } from "application/services/service-record-schedule-realignment.service";
import { KR_BUILTIN_CALENDAR } from "domain/utils/business-days";

describe("parsePlannedVector", () => {
    const first = {
        sessionIndex: 1,
        serviceDate: "2026-12-05",
        originalDate: "2026-12-05",
        assignmentId: "assignment-1",
        scheduleId: 101,
        employeeId: 201,
        provenanceVersion: "1",
    };
    const second = {
        sessionIndex: 2,
        serviceDate: "2026-12-06",
        originalDate: "2026-12-06",
        assignmentId: "assignment-2",
        scheduleId: 102,
        employeeId: 202,
        provenanceVersion: 1,
    };

    it("refuses a well-formed stored vector with fewer sessions than required", () => {
        expect(parsePlannedVector([first, second], 3, KR_BUILTIN_CALENDAR)).toBeNull();
    });

    it("sorts valid persisted entries and converts numeric provenance versions to strings", () => {
        expect(parsePlannedVector([second, first], 2, KR_BUILTIN_CALENDAR)).toEqual([
            {
                sessionIndex: 1,
                serviceDate: "2026-12-05",
                originalDate: "2026-12-05",
                assignmentId: "assignment-1",
                scheduleId: 101,
                employeeId: 201,
                provenanceVersion: "1",
            },
            {
                sessionIndex: 2,
                serviceDate: "2026-12-06",
                originalDate: "2026-12-06",
                assignmentId: "assignment-2",
                scheduleId: 102,
                employeeId: 202,
                provenanceVersion: "1",
            },
        ]);
    });

    it.each<[string, Prisma.JsonValue]>([
        ["a string raw value", "x"],
        ["a null raw value", null],
        ["a non-array sessions value", { sessions: "x" }],
        ["a non-object entry", ["x"]],
        ["a null entry", [null]],
        ["an array entry", [[]]],
        ["an entry missing required fields", [{ sessionIndex: 1 }]],
        ["an entry with a malformed field", [{ ...first, sessionIndex: "1" }]],
    ])("refuses %s", (_label, raw) => {
        expect(parsePlannedVector(raw, 1, KR_BUILTIN_CALENDAR)).toBeNull();
    });

    it("reads schedule, employee and version from nested provenance", () => {
        const raw = [{
            sessionIndex: 1,
            serviceDate: "2026-12-05",
            originalDate: "2026-12-05",
            assignmentId: "assignment-1",
            provenance: { scheduleId: 101, employeeId: 201, version: 1 },
        }];

        expect(parsePlannedVector(raw, 1, KR_BUILTIN_CALENDAR)).toEqual([first]);
    });

    it("prefers flat schedule, employee and provenanceVersion over nested values", () => {
        const raw = [{
            ...first,
            provenance: { scheduleId: 999, employeeId: 998, version: "nested" },
            version: "legacy-flat",
        }];

        expect(parsePlannedVector(raw, 1, KR_BUILTIN_CALENDAR)).toEqual([first]);
    });

    it("prefers nested version over the legacy flat version", () => {
        const raw = [{
            ...first,
            provenanceVersion: null,
            provenance: { version: 1 },
            version: "legacy-flat",
        }];

        expect(parsePlannedVector(raw, 1, KR_BUILTIN_CALENDAR)).toEqual([first]);
    });

    it("falls through null flat ownership fields to nested provenance", () => {
        const raw = [{
            ...first,
            scheduleId: null,
            employeeId: null,
            provenanceVersion: null,
            provenance: { scheduleId: 101, employeeId: 201, version: 1 },
        }];

        expect(parsePlannedVector(raw, 1, KR_BUILTIN_CALENDAR)).toEqual([first]);
    });

    it("falls back to the legacy flat version when other versions are absent", () => {
        const raw = [{ ...first, provenanceVersion: null, version: 1 }];

        expect(parsePlannedVector(raw, 1, KR_BUILTIN_CALENDAR)).toEqual([first]);
    });

    it("reads a sessions wrapper object", () => {
        expect(parsePlannedVector({ sessions: [first] }, 1, KR_BUILTIN_CALENDAR)).toEqual([first]);
    });
});
