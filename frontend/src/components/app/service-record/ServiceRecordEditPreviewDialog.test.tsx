import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";

import type { ServiceRecordEditPreviewResponse } from "@/features/service-records/types";

import { ServiceRecordEditPreviewDialog } from "./ServiceRecordEditPreviewDialog";

const DATA_COMPONENT = "desktop_service-record-admin_edit-preview-dialog";

const preview: ServiceRecordEditPreviewResponse = {
    previewId: "preview-1",
    draftId: "draft-1",
    draftVersion: 4,
    sourceCaseVersion: 7,
    sourceFingerprint: "source-7",
    requiredSessionCount: 3,
    calendarVersion: "kr-2026",
    before: {
        startDate: "2026-07-10",
        endDate: "2026-07-14",
        sessions: [
            {
                sessionIndex: 1,
                serviceDate: "2026-07-10",
                originalDate: "2026-07-10",
                assignmentId: "assignment-1",
                scheduleId: 7,
                employeeId: 12,
                provenanceVersion: "case-7",
            },
        ],
    },
    after: {
        startDate: "2026-07-13",
        endDate: "2026-07-17",
        sessions: [
            {
                sessionIndex: 1,
                serviceDate: "2026-07-13",
                originalDate: "2026-07-10",
                assignmentId: "assignment-1",
                scheduleId: 7,
                employeeId: 12,
                provenanceVersion: "case-8",
            },
        ],
    },
    provenance: [
        {
            assignmentId: "assignment-1",
            scheduleId: 7,
            employeeId: 12,
            startDate: "2026-07-10",
            endDate: "2026-07-14",
            provenanceVersion: "case-7",
        },
    ],
    contentChanges: {
        headerChanged: true,
        changedSessionIndexes: [1, 2],
    },
    impactedAssignments: ["assignment-1"],
    blockingReasons: [
        { code: "SOURCE_CHANGED", message: "원본 기록이 변경되어 확인이 필요합니다." },
    ],
    signatureMetadata: {
        treatment: "preserve_existing",
        evidence: "observed",
        sessions: [{
            sessionIndex: 1,
            hasSignature: true,
            signedAt: "2026-07-11T01:00:00.000Z",
            submittedAt: "2026-07-11T02:00:00.000Z",
        }],
    },
    documentScope: {
        evidence: "observed",
        serviceRecordSnapshot: {
            documentIds: ["doc-1"],
            snapshotVersion: 2,
            chunks: [{ documentId: "doc-1", snapshotVersion: 2, snapshotChunkIndex: 1 }],
        },
        currentRevision: { id: null, revisionNumber: null, formVersion: null },
        form: { version: 3 },
        contract: { currentDocumentId: "contract-1", stage: "completed" },
    },
};

describe("ServiceRecordEditPreviewDialog", () => {
    it("shows full before/after dates, assignment impact, content changes, and blocking reasons without a confirm action", () => {
        const onOpenChange = jest.fn();
        render(
            <ServiceRecordEditPreviewDialog
                open
                onOpenChange={onOpenChange}
                preview={preview}
                data-component={DATA_COMPONENT}
            />,
        );

        expect(screen.getByText("변경 전")).toBeInTheDocument();
        expect(screen.getByText("변경 후")).toBeInTheDocument();
        expect(screen.getByText("2026.07.10 ~ 2026.07.14")).toBeInTheDocument();
        expect(screen.getByText("2026.07.13 ~ 2026.07.17")).toBeInTheDocument();
        expect(screen.getAllByText("2026.07.13").length).toBeGreaterThan(0);
        expect(screen.getByText("assignment-1")).toBeInTheDocument();
        expect(screen.getByText("원본 기록이 변경되어 확인이 필요합니다.")).toBeInTheDocument();
        expect(screen.getByText("기본정보: 변경됨")).toBeInTheDocument();
        expect(screen.getByText("기록 회차: 1회차, 2회차")).toBeInTheDocument();
        expect(screen.getByText(/기존 제공기록지 서명과 실제 서명·제출 시각 보존/)).toBeInTheDocument();
        expect(screen.getByText(/계약 상태: 완료 계약 · 새 계약과 새 이용자 서명이 필요합니다/)).toBeInTheDocument();
        expect(screen.getByText(/문서·버전 범위: snapshot 2/)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /확정|완료|저장/ })).not.toBeInTheDocument();
        expect(document.querySelector(`[data-component="${DATA_COMPONENT}"]`)).toHaveAttribute(
            "data-source-component",
            "FormDialogShell",
        );

        fireEvent.click(screen.getByRole("button", { name: "닫기" }));
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("retains a visible error and does not expose preview controls while loading", () => {
        const onOpenChange = jest.fn();
        const { rerender } = render(
            <ServiceRecordEditPreviewDialog
                open
                onOpenChange={onOpenChange}
                preview={null}
                busy
                data-component={DATA_COMPONENT}
            />,
        );

        expect(screen.getByRole("status")).toHaveTextContent("미리보기를 불러오는 중");
        expect(screen.getByRole("button", { name: "닫기" })).toBeDisabled();

        rerender(
            <ServiceRecordEditPreviewDialog
                open
                onOpenChange={onOpenChange}
                preview={null}
                error="초안 미리보기를 불러오지 못했습니다."
                data-component={DATA_COMPONENT}
            />,
        );
        expect(screen.getByRole("alert")).toHaveTextContent("초안 미리보기를 불러오지 못했습니다.");
    });
});
