"use client";

import { ArrowRight, TriangleAlert } from "lucide-react";

import { StatusPill } from "@/components/app/ui/status-badge";
import { APP_CONTENT_CARD_TITLE_CLASS_NAME } from "@/components/ui/app-surface";
import type { PanelTitleNotice } from "./PanelTitleGroup";

const SOURCE_COMPONENT = "ContractInfoMismatch";

/** Tooltip and accessible name of the list's "정보 불일치" icon. */
export const CONTRACT_INFO_MISMATCH_HINT = "계약서와 정보가 달라요";

/** The detail header's one-line notice while the client info and the completed contract differ. */
export const CONTRACT_INFO_MISMATCH_NOTICE_TEXT =
  "계약서가 완료된 상태라 변경된 정보를 반영하지 못했어요. 계약서는 따로 확인해 주세요.";

/** Title and description of the confirmation shown before saving such a change. */
export const CONTRACT_INFO_CHANGE_CONFIRM_TITLE = "확인이 필요해요";
export const CONTRACT_INFO_CHANGE_CONFIRM_DESCRIPTION =
  "계약서 전자문서가 완료된 상태여서 전자문서는 변경할 수 없어요.\n그래도 수정할까요?";
export const CONTRACT_INFO_CHANGE_LIST_TITLE = "계약서와 달라지는 수정 사항";

const ICON_STROKE_WIDTH = 2.25;

export interface ContractInfoMismatchIconProps {
  "data-component"?: string;
}

/** The bare warning icon a client list row shows in its status slot. */
export function ContractInfoMismatchIcon({ "data-component": dataComponent }: ContractInfoMismatchIconProps) {
  return (
    <span
      data-component={dataComponent || undefined}
      data-slot="contract-info-mismatch-icon"
      data-source-component={SOURCE_COMPONENT}
      role="img"
      aria-label={CONTRACT_INFO_MISMATCH_HINT}
      title={CONTRACT_INFO_MISMATCH_HINT}
      className="inline-flex shrink-0 items-center justify-center text-v3-orange"
    >
      <TriangleAlert
        aria-hidden="true"
        strokeWidth={ICON_STROKE_WIDTH}
        className="size-[calc(20px*var(--glint-ui-scale,1))]"
      />
    </span>
  );
}

export interface ContractInfoMismatchPillProps {
  label?: string;
}

/** The warning pill, with its triangle icon, in the detail header's badge row. */
export function ContractInfoMismatchPill({ label = "정보 불일치" }: ContractInfoMismatchPillProps) {
  return (
    <StatusPill variant="warning" size="sm">
      <TriangleAlert aria-hidden="true" strokeWidth={ICON_STROKE_WIDTH} />
      {label}
    </StatusPill>
  );
}

/** The notice DetailPanel shows under the subtitle while the info differs. */
export function getContractInfoMismatchNotice(): PanelTitleNotice {
  return {
    tone: "warning",
    icon: <TriangleAlert aria-hidden="true" strokeWidth={ICON_STROKE_WIDTH} />,
    content: CONTRACT_INFO_MISMATCH_NOTICE_TEXT,
  };
}

export interface ContractInfoChangeListRow {
  key: string;
  label: string;
  previous: string;
  next: string;
}

export interface ContractInfoChangeListProps {
  "data-component": string;
  rows: ContractInfoChangeListRow[];
}

/** The card listing each contract field a save changes: old value struck through, then the new one. */
export function ContractInfoChangeList({ "data-component": dataComponent, rows }: ContractInfoChangeListProps) {
  return (
    <div
      data-component={dataComponent}
      data-source-component="ContractInfoChangeList"
      className="grid gap-[calc(10px*var(--glint-ui-scale,1))] rounded-[18px] bg-white p-[calc(16px*var(--glint-ui-scale,1))]"
    >
      <p data-component={`${dataComponent}_title`} className={APP_CONTENT_CARD_TITLE_CLASS_NAME}>
        {CONTRACT_INFO_CHANGE_LIST_TITLE}
      </p>
      <dl className="m-0 grid gap-[calc(10px*var(--glint-ui-scale,1))]">
        {rows.map((row) => (
          <div
            key={row.key}
            data-component={`${dataComponent}_row`}
            data-field={row.key}
            className="flex items-center justify-between gap-[calc(12px*var(--glint-ui-scale,1))] text-[calc(12.8px*var(--glint-ui-scale,1))]"
          >
            <dt className="shrink-0 font-semibold text-v3-text-muted">{row.label}</dt>
            <dd className="m-0 flex min-w-0 flex-wrap items-center justify-end gap-[calc(6px*var(--glint-ui-scale,1))] text-v3-text-muted">
              <del data-slot="contract-info-change-previous" className="break-all">{row.previous}</del>
              <ArrowRight
                aria-hidden="true"
                strokeWidth={ICON_STROKE_WIDTH}
                className="size-[calc(14px*var(--glint-ui-scale,1))] shrink-0"
              />
              <strong data-slot="contract-info-change-next" className="break-all font-bold text-v3-dark">{row.next}</strong>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
