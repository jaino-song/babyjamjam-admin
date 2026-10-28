"use client";

import { useState } from "react";
import dayjs from "dayjs";
import { Check, FileText, LoaderCircle, X } from "lucide-react";
import { formatKoreanPhoneNumber } from "@/lib/phone";
import { cn } from "@/lib/utils";
import type {
  HeadlessProgressState,
  HeadlessProgressStep,
  HeadlessProgressStepKey,
} from "@/components/app/eformsign/HeadlessProgressStepper";

const RING_RADIUS = 40;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const TEST_ID_PREFIX = "contract-creation-progress";

export interface ContractCreationProgressPanelProps {
  steps: readonly HeadlessProgressStep[];
  progress: HeadlessProgressState;
  recipientName?: string;
  recipientPhone?: string;
  errorHint?: string;
}

type RowState = "done" | "active" | "error" | "pending";

function getActiveTitle(key: HeadlessProgressStepKey, recipientName: string): string {
  switch (key) {
    case "client-started":
      return "전자문서 클라이언트 연결 중";
    case "info-inserted":
      return "이용자 정보를 입력하고 있어요";
    case "creating":
      return "전자문서를 생성하고 있어요";
    case "sent":
      return recipientName ? `${recipientName}님께 전송하고 있어요` : "이용자에게 전송하고 있어요";
    default:
      return "전자문서를 처리하고 있어요";
  }
}

export function ContractCreationProgressPanel({
  steps,
  progress,
  recipientName,
  recipientPhone,
  errorHint,
}: ContractCreationProgressPanelProps) {
  const currentIndex = progress.step ? steps.findIndex((item) => item.key === progress.step) : -1;
  // No server timestamp exists, so completion times are stamped client-side as rows turn done.
  const [completedAt, setCompletedAt] = useState<Partial<Record<HeadlessProgressStepKey, Date>>>({});

  // Adjust state while rendering (React's "derived state" pattern) so a row is stamped the
  // moment it turns done, without an effect-triggered cascade.
  if (currentIndex < 0) {
    // A finished run leaves its stamps behind; drop them so the next run starts clean.
    if (Object.keys(completedAt).length > 0) setCompletedAt({});
    return null;
  }
  const unstamped = steps.filter((item, idx) => {
    const isDone = progress.completed ? idx <= currentIndex : idx < currentIndex;
    return isDone && !completedAt[item.key];
  });
  if (unstamped.length > 0) {
    const stampedAt = new Date();
    setCompletedAt({
      ...completedAt,
      ...Object.fromEntries(unstamped.map((item) => [item.key, stampedAt])),
    });
  }

  const states: RowState[] = steps.map((_, idx) => {
    const isDone = progress.completed ? idx <= currentIndex : idx < currentIndex;
    const isActive = idx === currentIndex && !progress.completed && !progress.failed;
    const isFailed = idx === currentIndex && progress.failed;
    return isFailed ? "error" : isActive ? "active" : isDone ? "done" : "pending";
  });

  const doneCount = states.filter((state) => state === "done").length;
  const isCompleted = progress.completed && !progress.failed;
  const isFailed = progress.failed;
  const fraction = isCompleted ? 1 : steps.length > 0 ? doneCount / steps.length : 0;

  const name = recipientName?.trim() ?? "";
  const phone = recipientPhone?.trim() ? formatKoreanPhoneNumber(recipientPhone) : "";
  const recipientLine = [name ? `${name}님` : "", phone].filter(Boolean).join(" · ");

  const currentStep = steps[currentIndex];
  const title = isFailed
    ? currentStep.errorLabel
    : isCompleted
      ? "전자문서 전송 완료"
      : getActiveTitle(currentStep.key, name);
  const subtitle = isFailed ? errorHint : recipientLine;

  return (
    <div
      data-component="desktop_contracts_creation-progress_panel"
      data-source-component="ContractCreationProgressPanel"
      className="flex h-full w-full flex-col items-center gap-5 py-2"
    >
      <div
        data-component="desktop_contracts_creation-progress_panel_hero"
        className="flex flex-col items-center gap-2.5 text-center"
      >
        <div
          data-component="desktop_contracts_creation-progress_panel_hero_ring"
          data-state={isFailed ? "error" : isCompleted ? "done" : "active"}
          className="relative h-[84px] w-[84px]"
        >
          <svg
            viewBox="0 0 84 84"
            className="absolute inset-0 h-full w-full -rotate-90"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="42" cy="42" r={RING_RADIUS} strokeWidth="5" className="stroke-v3-border" />
            <circle
              cx="42"
              cy="42"
              r={RING_RADIUS}
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={RING_CIRCUMFERENCE * (1 - fraction)}
              className={cn(
                "transition-[stroke-dashoffset,stroke] duration-700 ease-out motion-reduce:transition-none",
                isFailed ? "stroke-destructive" : isCompleted ? "stroke-v3-green" : "stroke-v3-primary",
              )}
            />
          </svg>
          <div
            className={cn(
              "absolute inset-3 grid place-items-center rounded-full shadow-[0_6px_20px_hsla(214,50%,20%,0.08)] transition-colors duration-300 motion-reduce:transition-none",
              isFailed
                ? "animate-pop-in bg-destructive text-destructive-foreground motion-reduce:animate-none"
                : isCompleted
                  ? "animate-pop-in bg-v3-green text-white motion-reduce:animate-none"
                  : "bg-white text-v3-primary",
            )}
          >
            {isFailed ? (
              <X className="h-6 w-6" strokeWidth={3} />
            ) : isCompleted ? (
              <Check className="h-6 w-6" strokeWidth={3} />
            ) : (
              <FileText className="h-6 w-6" strokeWidth={2} />
            )}
          </div>
        </div>
        <p
          data-component="desktop_contracts_creation-progress_panel_hero_title"
          aria-live="polite"
          className={cn(
            "text-[17px] font-bold leading-snug",
            isFailed ? "text-destructive" : "text-v3-dark",
          )}
        >
          {title}
        </p>
        {subtitle ? (
          <p
            data-component="desktop_contracts_creation-progress_panel_hero_subtitle"
            className="text-xs text-v3-text-muted"
          >
            {subtitle}
          </p>
        ) : null}
      </div>

      <ol
        data-component="desktop_contracts_creation-progress_panel_timeline"
        data-testid={`${TEST_ID_PREFIX}-stepper`}
        aria-label="전자계약서 생성 진행 상태"
        className="w-full max-w-[26rem] rounded-[18px] border border-v3-border bg-white px-4 py-1.5"
      >
        {steps.map((item, idx) => {
          const state = states[idx];
          const doneAt = state === "done" ? completedAt[item.key] : undefined;

          return (
            <li
              key={item.key}
              data-component="desktop_contracts_creation-progress_panel_timeline_step"
              data-testid={`${TEST_ID_PREFIX}-step-${item.key}`}
              data-state={state}
              className={cn(
                "flex items-center gap-3 border-b border-dashed border-v3-border py-[11px] transition-opacity duration-300 last:border-b-0 motion-reduce:transition-none",
                state === "pending" && "opacity-40",
              )}
            >
              <span
                data-component="desktop_contracts_creation-progress_panel_timeline_step_circle"
                className={cn(
                  "grid h-6 w-6 shrink-0 place-items-center rounded-full border-[1.5px]",
                  state === "pending" && "border-v3-border bg-v3-dim-white text-v3-text-muted",
                  state === "active" && "border-v3-primary bg-v3-primary-light text-v3-primary",
                  state === "done" &&
                    "animate-pop-in border-v3-primary bg-v3-primary text-white motion-reduce:animate-none",
                  state === "error" &&
                    "border-destructive bg-destructive text-destructive-foreground",
                )}
              >
                {state === "done" ? (
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                ) : state === "active" ? (
                  <LoaderCircle
                    data-testid={`${TEST_ID_PREFIX}-spinner-${item.key}`}
                    className="contract-creation-processing-spinner h-3.5 w-3.5"
                    strokeWidth={2.4}
                  />
                ) : state === "error" ? (
                  <X
                    data-testid={`${TEST_ID_PREFIX}-error-${item.key}`}
                    className="h-3.5 w-3.5"
                    strokeWidth={3}
                  />
                ) : null}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span
                  data-component="desktop_contracts_creation-progress_panel_timeline_step_label"
                  className={cn(
                    "text-[13px] font-semibold leading-5",
                    (state === "done" || state === "active") && "text-v3-dark",
                    state === "pending" && "text-v3-text-muted",
                    state === "error" && "text-destructive",
                  )}
                >
                  {state === "error" ? item.errorLabel : item.label}
                </span>
                {state === "active" && (
                  <span className="mt-0.5 text-[11px] font-medium text-v3-text-muted">처리 중</span>
                )}
                {state === "error" && errorHint && (
                  <span className="mt-0.5 text-[11px] font-medium text-v3-text-muted">{errorHint}</span>
                )}
              </span>
              {doneAt ? (
                <time
                  data-component="desktop_contracts_creation-progress_panel_timeline_step_time"
                  dateTime={doneAt.toISOString()}
                  className="font-mono text-[11px] font-medium text-v3-text-muted"
                >
                  {dayjs(doneAt).format("HH:mm:ss")}
                </time>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
