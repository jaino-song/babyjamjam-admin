"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { clientKeys } from "@/features/clients/hooks/keys";
import { useUpdateClient } from "@/features/clients/hooks/use-clients";
import { formatKoreanPhoneNumber } from "@/lib/phone";
import { eformsignApi, type EformsignLinkConfirmation } from "@/services/api";

import {
    buildContractChoiceClientPatch,
    buildLinkConfirmRows,
    clientContractDocsQueryKey,
    isLinkConfirmReady,
    linkConfirmationsQueryKey,
    type LinkConfirmChoices,
    type LinkConfirmRow,
    type LinkConfirmSide,
} from "./contract-link-confirm";

const UPDATE_FAILED_MESSAGE = "고객 정보를 수정하지 못했습니다. 다시 시도해 주세요.";
const ADOPT_AFTER_UPDATE_FAILED_MESSAGE =
    "고객 정보는 수정했지만 계약서를 연결하지 못했습니다. 다시 시도해 주세요.";
const ADOPT_FAILED_MESSAGE = "계약서를 연결하지 못했습니다. 다시 시도해 주세요.";

interface ContractLinkConfirmDialogProps {
    /** The pending entry as it was when the dialog opened; it is not re-read while the dialog is open. */
    entry: EformsignLinkConfirmation;
    clientId: number;
    dataComponentPrefix: string;
    onClose: () => void;
}

function sideLabel(side: LinkConfirmSide, value: string | null): string {
    return `${side === "contract" ? "계약서" : "고객 정보"}: ${value ?? "없음"}`;
}

export function ContractLinkConfirmDialog({
    entry,
    clientId,
    dataComponentPrefix,
    onClose,
}: ContractLinkConfirmDialogProps) {
    const queryClient = useQueryClient();
    const updateClient = useUpdateClient();
    const idPrefix = useId();
    const rows = useMemo(() => buildLinkConfirmRows(entry), [entry]);
    const [choices, setChoices] = useState<LinkConfirmChoices>({});
    const [isRunning, setIsRunning] = useState(false);
    const [clientUpdated, setClientUpdated] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    // A ref guards the sequence itself (two clicks can land before a re-render disables the button).
    const runningRef = useRef(false);
    const clientUpdatedRef = useRef(false);

    const base = `${dataComponentPrefix}-contracts-link-confirmation-dialog`;
    const isReady = isLinkConfirmReady(rows, choices);

    const isEntryGone = async (): Promise<boolean> => {
        try {
            const pending = await queryClient.fetchQuery({
                queryKey: linkConfirmationsQueryKey(clientId),
                queryFn: () => eformsignApi.getLinkConfirmations(clientId),
                staleTime: 0,
                retry: false,
            });
            return !pending.some((item) => item.documentId === entry.documentId);
        } catch {
            return false;
        }
    };

    const handleConfirm = async () => {
        if (runningRef.current || !isReady) return;
        runningRef.current = true;
        setIsRunning(true);
        setErrorMessage(null);
        try {
            const patch = buildContractChoiceClientPatch(rows, choices);
            if (Object.keys(patch).length > 0 && !clientUpdatedRef.current) {
                try {
                    await updateClient.mutateAsync({ id: clientId, dto: patch });
                } catch {
                    setErrorMessage(UPDATE_FAILED_MESSAGE);
                    return;
                }
                clientUpdatedRef.current = true;
                setClientUpdated(true);
            }

            try {
                // A response with `warnings` still means the document is linked.
                await eformsignApi.adoptDocument(entry.documentId, clientId);
            } catch {
                // Saving the client re-runs automatic linking, so the server may have linked it already.
                if (!(await isEntryGone())) {
                    setErrorMessage(
                        clientUpdatedRef.current ? ADOPT_AFTER_UPDATE_FAILED_MESSAGE : ADOPT_FAILED_MESSAGE,
                    );
                    return;
                }
            }

            void queryClient.invalidateQueries({ queryKey: clientContractDocsQueryKey(clientId) });
            void queryClient.invalidateQueries({ queryKey: linkConfirmationsQueryKey(clientId) });
            void queryClient.invalidateQueries({ queryKey: clientKeys.all });
            void queryClient.invalidateQueries({ queryKey: clientKeys.detail(clientId) });
            onClose();
        } finally {
            runningRef.current = false;
            setIsRunning(false);
        }
    };

    const renderRow = (row: LinkConfirmRow) => {
        const rowBase = `${base}_row`;
        return (
            <li
                key={row.field}
                data-component={rowBase}
                data-slot="link-confirmation-row"
                className="space-y-2"
            >
                <p
                    data-component={`${rowBase}_label`}
                    className="text-sm font-semibold text-v3-text-muted"
                >
                    {row.label}
                </p>
                {row.selectableSides.length === 0 ? (
                    <p data-component={`${rowBase}_empty`} className="text-sm text-v3-text-muted">
                        양쪽 모두 정보가 없습니다
                    </p>
                ) : (
                    <RadioGroup
                        aria-label={row.label}
                        data-component={`${rowBase}_options`}
                        value={choices[row.field] ?? ""}
                        disabled={isRunning || clientUpdated}
                        onValueChange={(value) =>
                            setChoices((current) => ({ ...current, [row.field]: value as LinkConfirmSide }))
                        }
                    >
                        {(["contract", "client"] as const).map((side) => {
                            const value = side === "contract" ? row.contractValue : row.clientValue;
                            const optionId = `${idPrefix}-${row.field}-${side}`;
                            return (
                                <div
                                    key={side}
                                    data-component={`${rowBase}_option`}
                                    data-slot="link-confirmation-option"
                                    className="flex items-center gap-2"
                                >
                                    <RadioGroupItem
                                        id={optionId}
                                        value={side}
                                        disabled={value === null}
                                        data-component={`${rowBase}_option_${side}`}
                                    />
                                    <Label htmlFor={optionId} className="break-words text-sm font-normal">
                                        {sideLabel(side, value)}
                                    </Label>
                                </div>
                            );
                        })}
                    </RadioGroup>
                )}
            </li>
        );
    };

    return (
        <Dialog
            open
            onOpenChange={(open: boolean) => {
                if (!open && !isRunning) onClose();
            }}
        >
            <DialogContent
                data-component={base}
                showCloseButton
                className="sm:max-w-[420px]"
            >
                <DialogHeader data-component={`${base}_header`}>
                    <DialogTitle data-component={`${base}_title`}>계약서 연결 확인</DialogTitle>
                    <DialogDescription data-component={`${base}_description`}>
                        전화번호는 같지만 아래 내용이 달라 자동으로 연결하지 않았습니다. 항목마다 맞는 값을 고른 뒤
                        확정하세요.
                    </DialogDescription>
                </DialogHeader>
                <p data-component={`${base}_phone`} className="text-sm">
                    <span className="font-semibold text-v3-text-muted">전화번호</span>{" "}
                    {formatKoreanPhoneNumber(entry.document.phone)}
                </p>
                <ul
                    data-component={`${base}_rows`}
                    className="max-h-[calc(50vh)] space-y-4 overflow-y-auto"
                >
                    {rows.map(renderRow)}
                </ul>
                <p data-component={`${base}_note`} className="text-sm text-v3-text-muted">
                    &apos;계약서&apos; 값을 고르면 고객 정보가 그 값으로 수정됩니다.
                </p>
                {errorMessage ? (
                    <p
                        role="alert"
                        data-component={`${base}_error`}
                        className="text-sm font-semibold text-v3-burgundy"
                    >
                        {errorMessage}
                    </p>
                ) : null}
                <DialogFooter data-component={`${base}_footer`}>
                    <Button
                        type="button"
                        variant="neutral"
                        data-component={`${base}_cancel`}
                        disabled={isRunning}
                        onClick={onClose}
                    >
                        취소
                    </Button>
                    <Button
                        type="button"
                        data-component={`${base}_confirm`}
                        disabled={isRunning || !isReady}
                        onClick={() => void handleConfirm()}
                    >
                        확정
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
