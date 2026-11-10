import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";

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
    impactedAssignmentDetails: [
        { assignmentId: "assignment-1", employeeName: "임선녀", startDate: "2026-10-14", endDate: "2026-10-23" },
    ],
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
    it("groups changed dates and content into ascending primary-bordered session boxes", () => {
        const onOpenChange = jest.fn();
        render(<ServiceRecordEditPreviewDialog open onOpenChange={onOpenChange} preview={preview}
            sessionChanges={[
                { sessionIndex: 2, rows: [{ key: "notes", label: "특이사항", before: "입력 없음", after: "간식 시간 변경" }] },
                { sessionIndex: 1, rows: [{ key: "breast", label: "② 유방상태", before: "이상없음", after: "울혈" }] },
            ]}
            headerChanges={[{ key: "momName", label: "산모 성명", before: "기존", after: "변경" }]}
            data-component={DATA_COMPONENT} />);
        expect(screen.getByRole("dialog", { name: "수정 내용 확인" })).toHaveAttribute("data-side", "bottom");
        expect(screen.getByText("확인 후 수정 확정을 눌러주세요.")).toBeVisible();
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
        const boxes = document.querySelectorAll('[data-slot="session-change"]');
        expect(boxes).toHaveLength(2);
        expect(within(boxes[0] as HTMLElement).getByText("1회차")).toBeInTheDocument();
        expect(within(boxes[1] as HTMLElement).getByText("2회차")).toBeInTheDocument();
        for (const box of boxes) expect(box).toHaveClass("border-[1.5px]", "border-v3-primary!", "bg-white");
        const firstRows = within(boxes[0] as HTMLElement).getAllByRole("group");
        expect(firstRows[0]).toHaveTextContent("07.10(금) → 07.13(월)");
        expect(firstRows[1]).toHaveTextContent("② 유방상태이상없음 → 울혈");
        expect(screen.getByText("이상없음")).toHaveClass("text-v3-text-muted", "font-medium");
        expect(screen.getByText("울혈")).toHaveClass("text-v3-burgundy");
        expect(screen.getByText("입력 없음")).toHaveClass("text-v3-text-muted");
        expect(screen.queryByText(/초안 버전/)).not.toBeInTheDocument();
        expect(screen.getByText("기본정보")).toBeInTheDocument();
        expect(screen.getByText("산모 성명").parentElement).toHaveTextContent("기존 → 변경");
        expect(screen.getByText("임선녀 · 2026.10.14 ~ 2026.10.23")).toBeInTheDocument();
        expect(screen.queryByText(/assignment-1/)).not.toBeInTheDocument();
        expect(screen.getByText("원본 기록이 변경되어 확인이 필요합니다.")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /확정|완료|저장/ })).not.toBeInTheDocument();
        expect(screen.queryByText("서명")).not.toBeInTheDocument();
        expect(screen.getByText("전자문서")).toBeInTheDocument();
        expect(screen.getByText(/완료 계약 · 새 계약과 새 이용자 서명이 필요합니다/)).toBeInTheDocument();
        fireEvent.click(document.querySelector(`[data-component="${DATA_COMPONENT}_actions_close"]`)!);
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("omits all unaffected sections even with stored signatures and documents", () => {
        render(<ServiceRecordEditPreviewDialog open onOpenChange={jest.fn()} preview={{ ...preview,
            after: preview.before, contentChanges: { headerChanged: false, changedSessionIndexes: [] },
            impactedAssignments: [],
        }} />);
        for (const slot of ["content-changes", "assignments", "signature-metadata", "document-scope", "session-change"]) {
            expect(document.querySelector(`[data-slot="${slot}"]`)).not.toBeInTheDocument();
        }
        expect(screen.getByText("원본 기록이 변경되어 확인이 필요합니다.")).toBeInTheDocument();
        expect(screen.queryByText("변경된 내용이 없어요.")).not.toBeInTheDocument();
    });

    it("omits assignment impact for a note-only edit despite non-empty impacted assignments", () => {
        render(<ServiceRecordEditPreviewDialog open onOpenChange={jest.fn()} preview={{ ...preview,
            after: preview.before, blockingReasons: [],
            contentChanges: { headerChanged: false, changedSessionIndexes: [1] },
        }} sessionChanges={[
            { sessionIndex: 1, rows: [{ key: "notes", label: "특이사항", before: "입력 없음", after: "간식 시간 변경" }] },
        ]} />);
        expect(screen.getByText("간식 시간 변경")).toBeVisible();
        expect(screen.queryByText("배정 영향")).not.toBeInTheDocument();
        expect(document.querySelector('[data-slot="assignments"]')).not.toBeInTheDocument();
    });

    it("shows assignment impact for the owner of a date-moved session", () => {
        render(<ServiceRecordEditPreviewDialog open onOpenChange={jest.fn()} preview={{ ...preview,
            contentChanges: { headerChanged: false, changedSessionIndexes: [] }, blockingReasons: [],
        }} />);
        const section = document.querySelector('[data-slot="assignments"]')!;
        expect(section).toHaveTextContent("배정 영향");
        expect(within(section as HTMLElement).getAllByRole("listitem")).toHaveLength(1);
        expect(section).toHaveTextContent("임선녀 · 2026.10.14 ~ 2026.10.23");
    });

    it("lists only the moved session's owner when another caregiver's session has a note edit", () => {
        const unchangedSession = { ...preview.before.sessions[0], sessionIndex: 2,
            assignmentId: "assignment-2", employeeId: 13, scheduleId: 8 };
        render(<ServiceRecordEditPreviewDialog open onOpenChange={jest.fn()} preview={{ ...preview,
            before: { ...preview.before, sessions: [...preview.before.sessions, unchangedSession] },
            after: { ...preview.after, sessions: [unchangedSession, ...preview.after.sessions] },
            contentChanges: { headerChanged: false, changedSessionIndexes: [2] }, blockingReasons: [],
            impactedAssignments: ["assignment-1", "assignment-2"],
            impactedAssignmentDetails: [...preview.impactedAssignmentDetails!, {
                assignmentId: "assignment-2", employeeName: "내용 수정 관리사", startDate: null, endDate: null,
            }],
        }} sessionChanges={[
            { sessionIndex: 2, rows: [{ key: "notes", label: "특이사항", before: "입력 없음", after: "간식 시간 변경" }] },
        ]} />);
        const section = document.querySelector('[data-slot="assignments"]')!;
        expect(within(section as HTMLElement).getAllByRole("listitem")).toHaveLength(1);
        expect(section).toHaveTextContent("임선녀 · 2026.10.14 ~ 2026.10.23");
        expect(screen.queryByText("내용 수정 관리사")).not.toBeInTheDocument();
        expect(screen.getByText("간식 시간 변경")).toBeVisible();
    });

    it("shows the empty message when unchanged dates leave no assignment impact", () => {
        render(<ServiceRecordEditPreviewDialog open onOpenChange={jest.fn()} preview={{ ...preview,
            after: preview.before, contentChanges: { headerChanged: false, changedSessionIndexes: [] },
            blockingReasons: [],
        }} />);
        expect(screen.getByText("변경된 내용이 없어요.")).toBeVisible();
        expect(document.querySelector('[data-slot="assignments"]')).not.toBeInTheDocument();
    });

    it("omits assignment impact when no impacted id belongs to the moved session", () => {
        render(<ServiceRecordEditPreviewDialog open onOpenChange={jest.fn()} preview={{ ...preview,
            impactedAssignments: ["assignment-other"],
        }} />);
        expect(screen.getByText("서비스 제공일")).toBeVisible();
        expect(document.querySelector('[data-slot="assignments"]')).not.toBeInTheDocument();
    });

    it("shows only changed signed sessions when manual review is required", () => {
        render(<ServiceRecordEditPreviewDialog open onOpenChange={jest.fn()} preview={{ ...preview,
            signatureMetadata: { ...preview.signatureMetadata, treatment: "manual_review", sessions: [
                ...preview.signatureMetadata.sessions,
                { sessionIndex: 2, hasSignature: false, signedAt: null, submittedAt: null },
                { sessionIndex: 3, hasSignature: true, signedAt: null, submittedAt: null },
            ] },
        }} />);
        const section = document.querySelector('[data-slot="signature-metadata"]')!;
        expect(section).toHaveTextContent("서명");
        expect(section).toHaveTextContent("1회차 · 서명 보존 근거가 없어 수동 검토 필요");
        expect(section).not.toHaveTextContent("2회차");
        expect(section).not.toHaveTextContent("3회차");
    });

    it("omits signature review when only unsigned sessions changed", () => {
        render(<ServiceRecordEditPreviewDialog open onOpenChange={jest.fn()} preview={{ ...preview,
            after: preview.before,
            contentChanges: { headerChanged: false, changedSessionIndexes: [2] },
            signatureMetadata: { ...preview.signatureMetadata, treatment: "manual_review", sessions: [
                ...preview.signatureMetadata.sessions,
                { sessionIndex: 2, hasSignature: false, signedAt: null, submittedAt: null },
            ] },
        }} />);
        expect(screen.queryByText("서명")).not.toBeInTheDocument();
        expect(document.querySelector('[data-slot="signature-metadata"]')).not.toBeInTheDocument();
    });

    it.each(["header", "content"])("omits document work for %s-only edits", (kind) => {
        render(<ServiceRecordEditPreviewDialog open onOpenChange={jest.fn()} preview={{ ...preview,
            after: preview.before,
            contentChanges: { headerChanged: kind === "header", changedSessionIndexes: kind === "content" ? [1] : [] },
        }} />);
        expect(screen.queryByText("전자문서")).not.toBeInTheDocument();
    });

    it("shows contract work for a period change with a linked contract", () => {
        render(<ServiceRecordEditPreviewDialog open onOpenChange={jest.fn()} preview={{ ...preview,
            documentScope: { ...preview.documentScope, receipt: {
                evidence: "observed", eformsignDocId: null, tokenIds: [], sourceDocumentId: null,
            } },
        }} />);
        const section = document.querySelector('[data-slot="document-scope"]')!;
        expect(section).toHaveTextContent("전자문서");
        expect(section).toHaveTextContent("완료 계약 · 새 계약과 새 이용자 서명이 필요합니다.");
        expect(within(section as HTMLElement).queryByText(/영수증/)).not.toBeInTheDocument();
    });

    it("shows contract and receipt review for a period change with unverified scope", () => {
        render(<ServiceRecordEditPreviewDialog open onOpenChange={jest.fn()} preview={{ ...preview,
            documentScope: { ...preview.documentScope, evidence: "unverified",
                contract: { currentDocumentId: null, stage: null },
                receipt: { evidence: "unverified", eformsignDocId: null, tokenIds: [], sourceDocumentId: null },
            },
        }} />);
        const section = document.querySelector('[data-slot="document-scope"]')!;
        expect(section).toHaveTextContent("계약 상태 확인 필요");
        expect(section).toHaveTextContent("영수증");
    });

    it("omits document work for a period change with observed empty contract and receipt scopes", () => {
        render(<ServiceRecordEditPreviewDialog open onOpenChange={jest.fn()} preview={{ ...preview,
            documentScope: { ...preview.documentScope,
                contract: { currentDocumentId: null, stage: null },
                receipt: { evidence: "observed", eformsignDocId: null, tokenIds: [], sourceDocumentId: null },
            },
        }} />);
        expect(screen.queryByText("전자문서")).not.toBeInTheDocument();
    });

    it.each(["linked", "missing"])("shows only receipt work for a period change with %s receipt evidence", (kind) => {
        render(<ServiceRecordEditPreviewDialog open onOpenChange={jest.fn()} preview={{ ...preview,
            documentScope: { ...preview.documentScope,
                contract: { currentDocumentId: null, stage: null },
                receipt: kind === "missing" ? undefined : {
                    evidence: "observed", eformsignDocId: null, tokenIds: ["receipt-token"], sourceDocumentId: null,
                },
            },
        }} />);
        const section = document.querySelector('[data-slot="document-scope"]')!;
        expect(section).toHaveTextContent("영수증");
        expect(within(section as HTMLElement).queryByText(/계약/)).not.toBeInTheDocument();
    });

    it("shows a muted empty message for a loaded preview with all edits reverted and keeps confirmation available", () => {
        const onConfirm = jest.fn();
        render(<ServiceRecordEditPreviewDialog open onOpenChange={jest.fn()} onConfirm={onConfirm} preview={{ ...preview,
            after: preview.before, contentChanges: { headerChanged: false, changedSessionIndexes: [] },
            impactedAssignments: [], blockingReasons: [],
        }} />);
        expect(document.querySelector('[data-slot="content"]')).toHaveTextContent(/^변경된 내용이 없어요\.$/);
        expect(screen.getByText("변경된 내용이 없어요.")).toHaveClass("text-v3-text-muted");
        fireEvent.click(screen.getByRole("button", { name: "수정 확정" }));
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it("shows Korean blocking reasons once per code with the affected session", () => {
        render(
            <ServiceRecordEditPreviewDialog
                open
                onOpenChange={jest.fn()}
                preview={{ ...preview, blockingReasons: [
                    { code: "SERVICE_DATE_OUT_OF_RANGE", message: "고를 수 있는 기간이 아니에요.", sessionIndex: 3 },
                    { code: "MISSING_START_DATE", message: "Session 2 has no source start date", sessionIndex: 2 },
                ] }}
                data-component={DATA_COMPONENT}
            />,
        );
        expect(screen.getByText("고를 수 있는 기간이 아니에요 (3회차)")).toBeInTheDocument();
        expect(screen.getByText("서비스 시작일을 확인할 수 없는 회차가 있어요 (2회차)")).toBeInTheDocument();
        expect(screen.queryByText(/Session 2/)).not.toBeInTheDocument();
    });

    it("falls back to a generic caregiver name when details are missing or unnamed", () => {
        const legacyPreview: ServiceRecordEditPreviewResponse = { ...preview, impactedAssignmentDetails: undefined };
        const { unmount } = render(
            <ServiceRecordEditPreviewDialog open onOpenChange={jest.fn()} preview={legacyPreview} data-component={DATA_COMPONENT} />,
        );
        expect(screen.getByText("이름 없는 관리사")).toBeInTheDocument();
        expect(screen.queryByText(/assignment-1/)).not.toBeInTheDocument();
        unmount();

        render(
            <ServiceRecordEditPreviewDialog
                open
                onOpenChange={jest.fn()}
                preview={{
                    ...preview,
                    impactedAssignmentDetails: [{ assignmentId: "assignment-1", employeeName: null, startDate: "2026-10-14", endDate: null }],
                }}
                data-component={DATA_COMPONENT}
            />,
        );
        expect(screen.getByText("이름 없는 관리사 · 2026.10.14 ~ 없음")).toBeInTheDocument();
    });

    it("keeps the moved owner visible when details are empty", () => {
        render(
            <ServiceRecordEditPreviewDialog
                open
                onOpenChange={jest.fn()}
                preview={{ ...preview, impactedAssignmentDetails: [] }}
                data-component={DATA_COMPONENT}
            />,
        );
        expect(screen.getByText("이름 없는 관리사")).toBeInTheDocument();
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

        expect(screen.getByRole("status")).toHaveTextContent("수정사항 정리하는 중...");
        expect(document.querySelector(`[data-component="${DATA_COMPONENT}_actions_close"]`)).toBeDisabled();
        expect(screen.getAllByRole("button", { name: "닫기" })[0]).toBeDisabled();
        expect(screen.getByRole("button", { name: "확인 중…" })).toBeDisabled();
        expect(document.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(6);
        expect(screen.getByText("바뀌는 내용을 확인하고 있어요. 창을 닫거나 새로고침하지 마세요.")).toBeVisible();
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
        expect(onOpenChange).not.toHaveBeenCalled();

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

    it("offers the stale-preview retry affordance from the registered 409 status, not message text", () => {
        const onOpenChange = jest.fn();
        const onRefresh = jest.fn();
        const staleMessage = "미리보기가 오래되어 수정 확정에 실패했습니다. 최신 미리보기를 다시 확인해 주세요.";
        const { rerender } = render(
            <ServiceRecordEditPreviewDialog
                open
                onOpenChange={onOpenChange}
                preview={preview}
                confirmBusy={false}
                confirmError={staleMessage}
                confirmErrorStatus={409}
                onRefresh={onRefresh}
                data-component={DATA_COMPONENT}
            />,
        );

        expect(screen.getByText(staleMessage)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "최신 미리보기" }));
        expect(onRefresh).toHaveBeenCalledTimes(1);

        // A non-stale confirm failure keeps the copy but never the retry affordance —
        // even if a message accidentally contained the legacy marker text.
        rerender(
            <ServiceRecordEditPreviewDialog
                open
                onOpenChange={onOpenChange}
                preview={preview}
                confirmBusy={false}
                confirmError="미리보기가 오래되어 표시된 문구와 무관하게 상태 불일치가 해소되지 않았습니다."
                confirmErrorStatus={500}
                onRefresh={onRefresh}
                data-component={DATA_COMPONENT}
            />,
        );
        expect(screen.getByText("미리보기가 오래되어 표시된 문구와 무관하게 상태 불일치가 해소되지 않았습니다.")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "최신 미리보기" })).not.toBeInTheDocument();
    });
});
