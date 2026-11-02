"use client";

import { useId, useMemo, useState } from "react";

import type {
    ServiceRecordRevisionFieldChange,
    ServiceRecordRevisionSessionChange,
} from "@/features/service-records/types";
import {
    useClientServiceRecordCaregiverEditChanges,
    useClientServiceRecordRevisionChanges,
    useClientServiceRecordRevisionHistory,
} from "@/features/service-records/hooks/use-service-records";
import { ReviewRow, ReviewSection, ServiceRecordStepHeader, StickyActionBar } from "@/components/app/ui/service-record";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import {
    formatRevisionChangeValue,
    formatRevisionTimestamp,
    revisionChangeLabel,
} from "./revision-change-display";
import { BACK_LABEL } from "./screen/ids";

const SOURCE_COMPONENT = "RevisionHistoryView";

export const REVISION_HISTORY_TITLE = "수정 이력";
export const REVISION_HISTORY_EMPTY_COPY = "수정 이력이 없습니다.";
export const REVISION_HISTORY_LOAD_ERROR_COPY = "수정 이력을 불러오지 못했습니다.";
export const REVISION_CHANGES_LOAD_ERROR_COPY = "변경 내용을 불러오지 못했습니다.";
export const REVISION_BEFORE_UNAVAILABLE_COPY = "변경 전 내용이 기록되지 않은 수정입니다.";
export const REVISION_NO_CHANGES_COPY = "표시할 변경 내용이 없습니다.";
export const CAREGIVER_EDIT_LABEL = "제공인력 수정";

const SESSION_KIND_TAG: Record<ServiceRecordRevisionSessionChange["kind"], string | null> = {
    added: "추가됨",
    removed: "삭제됨",
    changed: null,
};

export interface RevisionHistoryViewProps {
    "data-component": string;
    clientId: string;
    onBack: () => void;
}

/**
 * One row of the merged picker. Revisions and caregiver edits live in different
 * tables, so their ids can collide; `key` is the only selection identity.
 */
type HistoryEntry =
    | { kind: "revision"; key: string; id: string; at: string; revisionNumber: number; label: string }
    | { kind: "edit"; key: string; id: string; at: string; revisionNumber: 0; label: string };

function numericClientId(clientId: string): number | null {
    const value = Number(clientId);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function RevisionHistoryView({ "data-component": root, clientId, onBack }: RevisionHistoryViewProps) {
    const child = (suffix: string) => `${root}_${suffix}`;
    const labelId = useId();
    const numericId = numericClientId(clientId);
    const history = useClientServiceRecordRevisionHistory(numericId);
    // Revisions and caregiver edits in one list, newest first whatever order
    // the server returned. Equal times: revision before edit, then by number/id.
    const entries = useMemo<HistoryEntry[]>(() => {
        const merged: HistoryEntry[] = [
            ...(history.data?.revisions ?? []).map((revision): HistoryEntry => ({
                kind: "revision",
                key: `revision:${revision.id}`,
                id: revision.id,
                at: revision.confirmedAt,
                revisionNumber: revision.revisionNumber,
                label: `#${revision.revisionNumber} · ${formatRevisionTimestamp(revision.confirmedAt)}`,
            })),
            ...(history.data?.caregiverEdits ?? []).map((edit): HistoryEntry => ({
                kind: "edit",
                key: `edit:${edit.id}`,
                id: edit.id,
                at: edit.editedAt,
                revisionNumber: 0,
                label: `${CAREGIVER_EDIT_LABEL} · ${edit.employeeName} · ${formatRevisionTimestamp(edit.editedAt)}`,
            })),
        ];
        return merged.sort((left, right) => (
            Date.parse(right.at) - Date.parse(left.at)
            || (left.kind === right.kind ? 0 : left.kind === "revision" ? -1 : 1)
            || right.revisionNumber - left.revisionNumber
            || right.id.localeCompare(left.id)
        ));
    }, [history.data]);
    const [chosenKey, setChosenKey] = useState<string | null>(null);
    // The newest entry overall is selected on entering the view.
    const selected = entries.find((entry) => entry.key === chosenKey) ?? entries[0] ?? null;
    // Only the query of the selected kind is enabled.
    const revisionChanges = useClientServiceRecordRevisionChanges(numericId, selected?.kind === "revision" ? selected.id : null);
    const editChanges = useClientServiceRecordCaregiverEditChanges(numericId, selected?.kind === "edit" ? selected.id : null);
    const changes = selected?.kind === "edit" ? editChanges : revisionChanges;

    const revisionSessions = (revisionChanges.data?.sessions ?? []).filter((session) => session.kind !== "changed" || session.changes.length > 0);
    const editSession = editChanges.data?.session.changes.length ? editChanges.data.session : null;
    const hasChanges = selected?.kind === "edit"
        ? editSession !== null
        : Boolean(revisionChanges.data && (revisionChanges.data.basicInfo.length > 0 || revisionSessions.length > 0));

    let body;
    if (history.isPending) {
        body = <p data-component={child("body_state-loading")} data-slot="state" className="text-sm text-v3-text-muted">불러오는 중…</p>;
    } else if (history.isError) {
        body = <p data-component={child("body_state-error")} data-slot="state" role="alert" className="text-sm text-v3-burgundy">{REVISION_HISTORY_LOAD_ERROR_COPY}</p>;
    } else if (entries.length === 0) {
        body = <p data-component={child("body_state-empty")} data-slot="state" className="text-sm text-v3-text-muted">{REVISION_HISTORY_EMPTY_COPY}</p>;
    } else {
        body = (
            <>
                <div data-component={child("body_picker")} data-slot="picker" className="flex flex-col gap-2">
                    <span id={labelId} data-component={child("body_picker_label")} className="text-sm font-semibold text-v3-dark">수정 시각</span>
                    <Select value={selected?.key} onValueChange={setChosenKey}>
                        <SelectTrigger data-component={child("body_picker_trigger")} aria-labelledby={labelId} className="w-full sm:w-72">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {entries.map((entry) => (
                                <SelectItem key={entry.key} value={entry.key}>
                                    {entry.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                {changes.isPending ? (
                    <p data-component={child("body_changes-loading")} data-slot="state" className="text-sm text-v3-text-muted">불러오는 중…</p>
                ) : changes.isError ? (
                    <p data-component={child("body_changes-error")} data-slot="state" role="alert" className="text-sm text-v3-burgundy">{REVISION_CHANGES_LOAD_ERROR_COPY}</p>
                ) : selected?.kind === "revision" && !revisionChanges.data?.beforeAvailable ? (
                    <p data-component={child("body_changes-unavailable")} data-slot="state" className="text-sm text-v3-text-muted">{REVISION_BEFORE_UNAVAILABLE_COPY}</p>
                ) : !hasChanges ? (
                    <p data-component={child("body_changes-empty")} data-slot="state" className="text-sm text-v3-text-muted">{REVISION_NO_CHANGES_COPY}</p>
                ) : (
                    <div data-component={child("body_changes")} data-slot="changes" className="flex flex-col">
                        {selected?.kind === "revision" && revisionChanges.data && revisionChanges.data.basicInfo.length > 0 ? (
                            <ReviewSection data-component={child("body_changes_basic")} titleId={`${labelId}-basic`} title="기본정보" tone="mom">
                                {revisionChanges.data.basicInfo.map((change) => (
                                    <ChangeRow key={change.path} change={change} root={child("body_changes_basic_rows_row")} />
                                ))}
                            </ReviewSection>
                        ) : null}
                        {(selected?.kind === "edit" ? (editSession ? [editSession] : []) : revisionSessions).map((session) => (
                            <SessionChangeGroup key={session.sessionIndex} session={session} root={child("body_changes_session")} idPrefix={labelId} />
                        ))}
                    </div>
                )}
            </>
        );
    }

    return (
        <div
            data-component={root}
            data-source-component={SOURCE_COMPONENT}
            className="flex min-h-dvh min-w-0 flex-col bg-white"
        >
            <ServiceRecordStepHeader
                data-component={child("top-bar")}
                title={REVISION_HISTORY_TITLE}
                progress={0}
                className="[&_[role=progressbar]]:hidden"
            />
            <div
                data-component={child("body")}
                className="flex min-w-0 flex-1 flex-col gap-[calc(14px*var(--glint-ui-scale,1))] px-[calc(16px*var(--glint-ui-scale,1))] pb-[calc(24px*var(--glint-ui-scale,1))] pt-[calc(16px*var(--glint-ui-scale,1))] sm:px-[calc(24px*var(--glint-ui-scale,1))]"
            >
                {body}
            </div>
            <StickyActionBar data-component={child("body_actions")}>
                <Button type="button" variant="outline" data-component={child("body_actions_back")} onClick={onBack}>
                    {BACK_LABEL}
                </Button>
            </StickyActionBar>
        </div>
    );
}

function ChangeRow({ change, root }: { change: ServiceRecordRevisionFieldChange; root: string }) {
    const rowId = useId();
    const label = revisionChangeLabel(change.path);
    const before = formatRevisionChangeValue(change.path, change.before);
    const after = formatRevisionChangeValue(change.path, change.after);
    return (
        <ReviewRow
            data-component={root}
            labelId={rowId}
            label={label}
            layout="note"
            value={(
                <>
                    <span data-slot="before-value">{before}</span>
                    <span data-slot="arrow" aria-label="에서 다음으로" role="img"> → </span>
                    <span data-slot="after-value">{after}</span>
                </>
            )}
        />
    );
}

function SessionChangeGroup({ session, root, idPrefix }: { session: ServiceRecordRevisionSessionChange; root: string; idPrefix: string }) {
    const titleId = `${idPrefix}-session-${session.sessionIndex}`;
    const date = session.serviceDateAfter ?? session.serviceDateBefore;
    const tag = SESSION_KIND_TAG[session.kind];
    return (
        <section
            aria-labelledby={titleId}
            data-component={root}
            data-slot="session-change"
            className="mt-[calc(14px*var(--glint-ui-scale,1))]"
        >
            <div
                data-component={`${root}_header`}
                className="mb-[calc(6px*var(--glint-ui-scale,1))] flex items-center gap-[calc(8px*var(--glint-ui-scale,1))]"
            >
                <h2 id={titleId} data-component={`${root}_header_title`} className="m-0 text-[calc(13px*var(--glint-ui-scale,1))] font-extrabold text-v3-dark">
                    {session.sessionIndex}회차{date ? ` · ${date}` : ""}
                </h2>
                {tag ? (
                    <span
                        data-component={`${root}_header_kind`}
                        data-slot="kind-tag"
                        className="inline-block rounded-[6px] bg-v3-dim-white px-[calc(7px*var(--glint-ui-scale,1))] py-[calc(2px*var(--glint-ui-scale,1))] text-[calc(10.5px*var(--glint-ui-scale,1))] font-extrabold text-v3-text-muted"
                    >
                        {tag}
                    </span>
                ) : null}
            </div>
            <div data-component={`${root}_rows`} className="flex flex-col gap-[calc(6px*var(--glint-ui-scale,1))]">
                {session.changes.map((change) => (
                    <ChangeRow key={change.path} change={change} root={`${root}_rows_row`} />
                ))}
            </div>
        </section>
    );
}
