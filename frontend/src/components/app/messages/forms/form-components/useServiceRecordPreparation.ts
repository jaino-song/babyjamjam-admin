import { useEffect, useMemo, useState } from "react";
import type { PrepareServiceRecordLinkResponse } from "@babyjamjam/shared/types/service-record";
import { caseServiceRecordLinkAssignment, legacyServiceRecordLinkAssignment, preparedServiceRecordMembers } from "@babyjamjam/shared/utils";
import { serviceRecordsApi } from "@/features/service-records/api/service-records.api";
import { useClientServiceRecords } from "@/features/service-records/hooks/use-service-records";
import { isValidKoreanPhoneNumber, normalizeKoreanPhoneLookupKey } from "@/lib/phone";
import type { ServiceRecordLinkPreparation } from "./TemplateMessageFormLayout";

function verifyPreparation(
  response: PrepareServiceRecordLinkResponse,
  employeeId: number,
  selected: { caseId: string; assignmentVersion: number }[],
): boolean {
  if (!selected.length) return response.kind !== "group" && Boolean(response.preparedLinkToken && response.serviceRecordUrl);
  return Boolean(preparedServiceRecordMembers(response, employeeId, selected));
}

export function useServiceRecordPreparation({
  clientId, employeeId, employeePhone, registeredPhone, template,
}: {
  clientId: number | null;
  employeeId: number | null;
  employeePhone: string;
  registeredPhone: string;
  template: string | null;
}) {
  const overview = useClientServiceRecords(clientId, { enabled: employeeId !== null, refreshOnFocus: true });
  const selectionScope = JSON.stringify([clientId, employeeId]);
  const [choice, setChoice] = useState<{ scope: string; excluded: string[] } | null>(null);
  const [result, setResult] = useState<{ key: string; value: ServiceRecordLinkPreparation | null } | null>(null);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const cases = overview.data?.cases;
  const { eligible, chosen, selected, groupScheduleId } = useMemo(() => {
    const eligible = (employeeId === null ? [] : cases ?? []).flatMap((record) => {
      const assignment = caseServiceRecordLinkAssignment(record);
      return assignment && assignment.employeeId === employeeId ? [{ record, ...assignment }] : [];
    });
    const excluded = choice?.scope === selectionScope ? choice.excluded : [];
    const chosen = eligible.filter(({ record }) => !excluded.includes(record.caseId));
    const scheduleIds = new Set(chosen.map(({ scheduleId }) => scheduleId));
    return {
      eligible,
      chosen,
      selected: chosen.map(({ record, assignmentVersion }) => ({ caseId: record.caseId, assignmentVersion })),
      groupScheduleId: scheduleIds.size === 1 ? chosen[0].scheduleId : undefined,
    };
  }, [cases, choice, employeeId, selectionScope]);
  const legacy = overview.data && legacyServiceRecordLinkAssignment(overview.data);
  const legacyAssignment = legacy?.employee.id === employeeId ? legacy : undefined;
  const scheduleId = groupScheduleId ?? legacyAssignment?.scheduleId;
  const serviceStartDate = legacyAssignment?.startDate?.slice(0, 10) ?? "";
  const authoritativePhone = legacyAssignment?.employee.phone ?? registeredPhone;
  const phone = normalizeKoreanPhoneLookupKey(authoritativePhone);
  const locked = Boolean(eligible.length || legacyAssignment);
  const online = !overview.isError && !overview.isFetching && !overview.isPaused;
  const key = scheduleId && employeeId !== null && isValidKoreanPhoneNumber(phone) && template
    ? JSON.stringify([clientId, employeeId, scheduleId, phone, selected, template, serviceStartDate, attempt])
    : null;

  // Clear a previous credential even if the operator later returns to the same selection.
  // A pending refetch hides it immediately while the persisted assignment is checked.
  if (lastKey !== key) {
    setLastKey(key);
    setResult(null);
  }
  const resultKey = result?.key;
  useEffect(() => {
    if (!online || key === null || resultKey === key || scheduleId === undefined || employeeId === null) return;
    let cancelled = false;
    const request = selected.length
      ? { employeeId, caseIds: selected.map(({ caseId }) => caseId), recipientPhone: phone }
      : { recipientPhone: phone };
    void serviceRecordsApi.prepareLink(scheduleId, request).then(({ data }) => {
      if (!cancelled) {
        setResult({
          key,
          value: verifyPreparation(data, employeeId, selected)
            ? { ...data, scheduleId, serviceStartDate, recipientPhone: phone }
            : null,
        });
      }
    }).catch(() => {
      if (!cancelled) setResult({ key, value: null });
    });
    return () => { cancelled = true; };
  }, [employeeId, key, online, phone, resultKey, scheduleId, selected, serviceStartDate]);

  function toggleCase(caseId: string, checked: boolean) {
    setChoice((current) => {
      const excluded = current?.scope === selectionScope ? current.excluded : [];
      return {
        scope: selectionScope,
        excluded: checked ? excluded.filter((id) => id !== caseId) : [...excluded, caseId],
      };
    });
  }

  return {
    eligible,
    chosen,
    toggleCase,
    retry: () => {
      setAttempt((current) => current + 1);
      void overview.refetch();
    },
    clearSelection: () => { setChoice(null); setAttempt((current) => current + 1); },
    preparation: online && result && result.key === key ? result.value : null,
    pending: (overview.isFetching && employeeId !== null) || (key !== null && result?.key !== key),
    hasError: overview.isError || (key !== null && result?.key === key && result.value === null),
    locked,
    phone: locked ? authoritativePhone : employeePhone,
  };
}
