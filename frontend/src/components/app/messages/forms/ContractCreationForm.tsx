"use client";
import dayjs from "dayjs";
import "dayjs/locale/ko";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { t } from "@/lib/i18n/translations";
import { useFormStore } from "@/stores/form-store";
import { useLocale } from "@/providers/LocaleProvider";
import { eformsignApi } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SteppedWizard } from "@/components/app/v3";
import type { WizardStep } from "@/components/app/v3";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useEformsign } from "@/hooks/useEformsign";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import type { EformsignDocumentOption } from "@/lib/eformsign/types";

// YYYY-MM-DD ↔ YYMMDD helpers for the contract-info date inputs.
// 2000-2099만 대상으로 단순 변환. 6자리 미만 raw는 빈 ISO로 매핑하여 partial input 시 외부 state는 비워둔다.
function isoToYymmdd(iso: string): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return m[1].slice(2) + m[2] + m[3];
}
function yymmddToIso(yymmdd: string): string {
  if (yymmdd.length !== 6) return "";
  return `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
}

// 한국 공휴일 (대체공휴일 포함). 발급 가능 연도 기준 2026~2027 hardcode — 매년 갱신 필요.
// 출처: 공공데이터포털 특일정보 / 인사혁신처 공고. 음력 기반 명절은 다음 양력 변환:
// - 설날 2026: 2/16(월),17(화),18(수); 2027: 2/6(토),7(일),8(월) + 대체 2/9(화)
// - 추석 2026: 9/24(목),25(금),26(토) + 대체 9/28(월); 2027: 9/14(화),15(수),16(목)
// - 부처님오신날 2026: 5/24(일) + 대체 5/25(월); 2027: 5/13(목)
const KR_HOLIDAYS = new Set<string>([
  // 2026
  "2026-01-01", // 신정
  "2026-02-16", "2026-02-17", "2026-02-18", // 설날
  "2026-03-01", // 삼일절
  "2026-03-02", // 삼일절 대체 (일요일)
  "2026-05-05", // 어린이날
  "2026-05-24", "2026-05-25", // 부처님오신날 + 대체
  "2026-06-06", // 현충일
  "2026-08-15", // 광복절
  "2026-08-17", // 광복절 대체 (토요일)
  "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-28", // 추석 + 대체
  "2026-10-03", "2026-10-05", // 개천절 + 대체 (토요일)
  "2026-10-09", // 한글날
  "2026-12-25", // 크리스마스
  // 2027
  "2027-01-01", // 신정
  "2027-02-06", "2027-02-07", "2027-02-08", "2027-02-09", // 설날 + 대체
  "2027-03-01", // 삼일절
  "2027-05-05", // 어린이날
  "2027-05-13", // 부처님오신날
  "2027-06-06", "2027-06-07", // 현충일 + 대체 (일요일)
  "2027-08-15", "2027-08-16", // 광복절 + 대체 (일요일)
  "2027-09-14", "2027-09-15", "2027-09-16", // 추석
  "2027-10-03", "2027-10-04", // 개천절 + 대체 (일요일)
  "2027-10-09", // 한글날
  "2027-12-25",
]);

function isBusinessDayKr(iso: string): boolean {
  // iso = "YYYY-MM-DD". new Date(iso) parses as UTC midnight; getUTCDay() returns DOW (0=Sun, 6=Sat).
  if (!iso) return false;
  const d = new Date(iso + "T00:00:00Z");
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !KR_HOLIDAYS.has(iso);
}

// startISO를 1일차로 카운트하되, 시작일이 비영업일이면 다음 영업일부터 1일차.
// 반환: N번째 영업일의 ISO 문자열.
function calcEndDateBusinessDays(startISO: string, n: number): string {
  if (!startISO || !Number.isFinite(n) || n <= 0) return "";
  const startMatch = startISO.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!startMatch) return "";
  const cursor = new Date(startISO + "T00:00:00Z");
  let counted = 0;
  // 안전 가드: 충분한 상한 (영업일 30일은 달력 60일 안에 끝남, 여유 2x)
  for (let i = 0; i < 365 && counted < n; i++) {
    const iso = cursor.toISOString().slice(0, 10);
    if (isBusinessDayKr(iso)) {
      counted++;
      if (counted === n) return iso;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return "";
}
import { eformsignQueryKeys } from "@/hooks/useEformsignDocuments";
import { useVoucherPriceInfos, useVoucherYears, useAreaTemplates } from "@/hooks";
import voucherOptions from "../templates/json/voucher.json";
import { NameInput } from "./form-components/NameInput";
import { ContactInput } from "./form-components/ContactInput";
import { ClientAutocomplete } from "../../clients/ClientAutocomplete";
import { EmployeeAutocomplete } from "../../clients/EmployeeAutocomplete";
import { ClientFormDialog } from "../../clients/ClientFormDialog";
import { useCreateClient } from "@/hooks/useClients";
import { useEmployees } from "@/hooks/useEmployees";
import type { Client } from "@/lib/client/types";
import type { Employee } from "@/hooks/useEmployees";

interface ContractDataDto {
  customerName: string;
  customerContact: string;
  customerDOB: string;
  customerAddress: string;
  caretaker1Name: string;
  caretaker1Contact: string;
  type: string;
  days: string;
  area: string;
  contractDuration: string;
  startYear: string;
  startMonth: string;
  startDay: string;
  startDate: string;
  endYear: string;
  endMonth: string;
  endDay: string;
  endDate: string;
  paymentYear: string;
  paymentMonth: string;
  paymentDay: string;
  receiptYear: string;
  receiptMonth: string;
  receiptDay: string;
  fullPrice: string;
  grant: string;
  actualPrice: string;
  issuerPhone?: string;
}

const formatPrice = (price: number | string): string => {
  if (!price && price !== 0) return "";
  const cleaned = typeof price === "string" ? price.replace(/,/g, "") : String(price);
  const num = parseInt(cleaned, 10);
  if (isNaN(num)) return "";
  return num.toLocaleString("ko-KR");
};

const parsePrice = (value: string | null | undefined): string => {
  if (!value) return "";
  return value.replace(/,/g, "");
};

const COMPLETED_PILL =
  "inline-flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-v3-green-light border-[1.5px] border-[hsl(137,40%,85%)] text-[0.85rem] font-semibold text-v3-dark";

const INPUT_CLS = "bg-white text-[0.85rem] font-[Pretendard] text-v3-dark";

const LABEL_CLS = "text-xs font-semibold text-v3-text-muted";

const SELECT_CLS =
  "w-full px-4 py-3 rounded-2xl border-[1.5px] border-v3-border bg-white text-[0.85rem] font-[Pretendard] text-v3-dark outline-none transition-all focus:border-v3-primary focus:shadow-[0_0_0_3px_hsla(214,100%,34%,0.08)] appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_12px_center]";

export const ContractCreationForm = () => {
  const router = useRouter();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { data: authUser } = useGetAuthUser();
  const [activeStep, setActiveStep] = useState(0);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [documentCreated, setDocumentCreated] = useState(false);
  const [isClientDialogOpen, setIsClientDialogOpen] = useState(false);
  const [startDateInput, setStartDateInput] = useState("");
  const [endDateInput, setEndDateInput] = useState("");
  const [paymentDateInput, setPaymentDateInput] = useState("");

  const { isLoaded: isEformsignLoaded, isLoading: isEformsignLoading, error: eformsignError, openDocument } =
    useEformsign();

  const {
    clientId,
    isManualEntry,
    name,
    phone,
    birthday,
    address,
    dueDate,
    employeeId,
    isEmployeeManualEntry,
    employeeName,
    employeePhone,
    showEmployee2,
    employee2Id,
    isEmployee2ManualEntry,
    employee2Name,
    employee2Phone,
    startDate,
    endDate,
    paymentDate,
    fullPrice,
    grant,
    actualPrice,
    voucherType,
    voucherDuration,
    voucherYear,
    area,
    setClientId,
    setIsManualEntry,
    setName,
    setPhone,
    setBirthday,
    setAddress,
    setDueDate,
    resetClientFields,
    setIsEmployeeManualEntry,
    setEmployeeName,
    setEmployeePhone,
    setEmployeeSelection,
    resetEmployeeFields,
    setShowEmployee2,
    setIsEmployee2ManualEntry,
    setEmployee2Name,
    setEmployee2Phone,
    setEmployee2Selection,
    resetEmployee2Fields,
    setStartDate,
    setEndDate,
    setPaymentDate,
    setFullPrice,
    setGrant,
    setActualPrice,
    setVoucherType,
    setVoucherDuration,
    setVoucherYear,
    setArea,
  } = useFormStore();

  // Sync YYMMDD raw display when external YYYY-MM-DD state changes (e.g., client autofill).
  useEffect(() => { setStartDateInput(isoToYymmdd(startDate)); }, [startDate]);
  useEffect(() => { setEndDateInput(isoToYymmdd(endDate)); }, [endDate]);
  useEffect(() => { setPaymentDateInput(isoToYymmdd(paymentDate)); }, [paymentDate]);

  // 시작일과 서비스 기간이 모두 정해지면 평일(주말+한국 공휴일 제외) 기준으로 종료일 자동 계산.
  // 사용자가 종료일을 수동 편집해도 startDate/voucherDuration이 다시 바뀌어야만 덮어쓴다.
  useEffect(() => {
    if (!startDate || !voucherDuration) return;
    const n = parseInt(voucherDuration, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    const computed = calcEndDateBusinessDays(startDate, n);
    if (computed) setEndDate(computed);
  }, [startDate, voucherDuration, setEndDate]);

  const { data: voucherPriceInfos = [], isLoading: isVoucherPriceInfosLoading } = useVoucherPriceInfos(
    voucherType,
    voucherYear
  );
  const { data: areaTemplates = [], isLoading: isAreaTemplatesLoading } = useAreaTemplates();
  const { data: voucherYears = [], isLoading: isVoucherYearsLoading } = useVoucherYears();
  const { data: employees } = useEmployees();
  const createClientMutation = useCreateClient();
  const selectedClientRef = useRef<Client | null>(null);
  const stepLabels = t(locale, "contract-msg.pagination-steps") as unknown as string[];

  const handleVoucherYearChange = (value: number) => {
    setVoucherYear(value);
    setVoucherType("");
    setVoucherDuration("");
    setFullPrice("");
    setGrant("");
    setActualPrice("");
  };

  const handleVoucherTypeChange = (value: string) => {
    setVoucherType(value);
    setVoucherDuration("");
    setFullPrice("");
    setGrant("");
    setActualPrice("");
  };

  const handleDurationChange = (duration: string) => {
    const selectedVoucher = voucherPriceInfos.find((v) => v.duration === duration);
    if (selectedVoucher) {
      setVoucherDuration(duration);
      setFullPrice(selectedVoucher.fullPrice?.toString() ?? "");
      setGrant(selectedVoucher.grant?.toString() ?? "");
      setActualPrice(selectedVoucher.actualPrice?.toString() ?? "");
    }
  };

  const handleDialogClose = () => {
    setIsDialogOpen(false);
    if (documentCreated) {
      setDocumentCreated(false);
    }
  };

  const handleClientSelect = (selectedClientId: number | null, client: Client | null) => {
    setClientId(selectedClientId);
    selectedClientRef.current = client;

    if (client) {
      setName(client.name);
      setPhone(client.phone || "");
      setBirthday(client.birthday || "");
      setAddress(client.address || "");
      setDueDate(client.dueDate || "");

      if (client.type) {
        setVoucherType(client.type);
      }
      if (client.duration) {
        setVoucherDuration(client.duration.toString());
      }
      if (client.fullPrice) {
        setFullPrice(client.fullPrice);
      }
      if (client.grant) {
        setGrant(client.grant);
      }
      if (client.actualPrice) {
        setActualPrice(client.actualPrice);
      }
      if (client.startDate) {
        setStartDate(client.startDate);
        setPaymentDate(client.startDate);
      }
      if (client.endDate) {
        setEndDate(client.endDate);
      }

      if (client.primaryEmployee && employees) {
        const primaryEmp = employees.find((e) => e.id === client.primaryEmployee?.id);
        if (primaryEmp) {
          setEmployeeSelection(primaryEmp.id, primaryEmp.name, primaryEmp.phone);
          setIsEmployeeManualEntry(false);
        }
      }

      if (client.secondaryEmployee && employees) {
        const secondaryEmp = employees.find((e) => e.id === client.secondaryEmployee?.id);
        if (secondaryEmp) {
          setShowEmployee2(true);
          setEmployee2Selection(secondaryEmp.id, secondaryEmp.name, secondaryEmp.phone);
          setIsEmployee2ManualEntry(false);
        }
      }
    } else {
      setName("");
      setPhone("");
      setBirthday("");
      setAddress("");
      setDueDate("");
      setVoucherType("");
      setVoucherDuration("");
      setFullPrice("");
      setGrant("");
      setActualPrice("");
      setStartDate("");
      setEndDate("");
      resetEmployeeFields();
      resetEmployee2Fields();
    }
  };

  const handleToggleManualEntry = () => {
    resetClientFields();
    setIsManualEntry(!isManualEntry);
  };

  const handleOpenClientDialog = () => {
    setIsClientDialogOpen(true);
  };

  const handleClientCreated = (newClient: Client) => {
    handleClientSelect(newClient.id, newClient);
  };

  const handleEmployeeSelect = (selectedEmployeeId: number | null, employee: Employee | null) => {
    if (employee) {
      setEmployeeSelection(selectedEmployeeId, employee.name, employee.phone);
    } else {
      setEmployeeSelection(null, "", "");
    }
  };

  const handleToggleEmployeeManualEntry = () => {
    resetEmployeeFields();
    setIsEmployeeManualEntry(!isEmployeeManualEntry);
  };

  const handleEmployee2Select = (selectedEmployeeId: number | null, employee: Employee | null) => {
    if (employee) {
      setEmployee2Selection(selectedEmployeeId, employee.name, employee.phone);
    } else {
      setEmployee2Selection(null, "", "");
    }
  };

  const handleToggleEmployee2ManualEntry = () => {
    resetEmployee2Fields();
    setShowEmployee2(true);
    setIsEmployee2ManualEntry(!isEmployee2ManualEntry);
  };

  const handleToggleShowEmployee2 = () => {
    if (showEmployee2) {
      resetEmployee2Fields();
    } else {
      setShowEmployee2(true);
    }
  };

  const handleContractCreation = async () => {
    if (!isEformsignLoaded) {
      setSubmitError("eformsign SDK가 아직 로드되지 않았습니다. 잠시 후 다시 시도해주세요.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      let finalClientId = clientId;

      if (isManualEntry && !clientId) {
        const newClient = await createClientMutation.mutateAsync({
          name,
          phone,
          birthday: birthday || undefined,
          address: address || undefined,
          dueDate: dueDate || undefined,
          primaryEmployeeId: null,
          careCenter: false,
          voucherClient: true,
          breastPump: false,
        });
        finalClientId = newClient.id;
        setClientId(newClient.id);
      }

      const executionTime = Date.now();
      const authResult = await eformsignApi.authenticate(executionTime);

      if (!authResult.success) {
        throw new Error("Failed to authenticate");
      }

      const start = dayjs(startDate);
      const end = endDate ? dayjs(endDate) : null;
      const payment = dayjs(paymentDate);
      const today = dayjs();

      const contractData: ContractDataDto = {
        customerName: name,
        customerContact: phone,
        customerDOB: birthday,
        customerAddress: address,
        // inputOutsiderNumber (이용자 연락처) prefill 용 — 현재 로그인 계정의 phone 사용
        issuerPhone: authUser?.phone ?? undefined,
        caretaker1Name: employeeName,
        caretaker1Contact: employeePhone,
        type: voucherType,
        days: voucherDuration,
        area,
        contractDuration: end
          ? `${start.format("YYYY-MM-DD")} ~ ${end.format("YYYY-MM-DD")}`
          : `${start.format("YYYY-MM-DD")} ~`,
        startYear: start.format("YY"),
        startMonth: start.format("MM"),
        startDay: start.format("DD"),
        startDate,
        endYear: end ? end.format("YY") : "",
        endMonth: end ? end.format("MM") : "",
        endDay: end ? end.format("DD") : "",
        endDate,
        paymentYear: payment.format("YY"),
        paymentMonth: payment.format("MM"),
        paymentDay: payment.format("DD"),
        receiptYear: today.format("YY"),
        receiptMonth: today.format("MM"),
        receiptDay: today.format("DD"),
        fullPrice,
        grant,
        actualPrice,
      };

      const documentOption: EformsignDocumentOption = await eformsignApi.generateDocument(
        contractData,
        finalClientId ?? undefined
      );

      setIsDialogOpen(true);

      setTimeout(() => {
        openDocument(documentOption, "eformsign_iframe", {
          onSuccess: async (response) => {
            if (finalClientId && response.document_id) {
              try {
                await eformsignApi.createDocRecord({
                  documentId: response.document_id,
                  clientId: finalClientId,
                  statusType: "060",
                  statusDetail: "대기",
                  stepType: "01",
                  stepIndex: "1",
                  stepName: "서명 요청",
                  stepRecipientType: "01",
                  stepRecipientName: name,
                  stepRecipientSms: phone,
                  expiredDate: end.add(30, "day").toISOString(),
                  linkToClient: true,
                });
              } catch (docError) {
                console.error("Failed to create eformsign doc record:", docError);
              }
            }

            queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.allDocuments() });
            setDocumentCreated(true);
            alert("계약서가 성공적으로 생성되었습니다.");
            handleDialogClose();
          },
          onError: (response) => {
            console.error("Document creation failed:", response);
            setSubmitError(`문서 생성 실패: ${response.message}`);
            handleDialogClose();
          },
        });
      }, 500);
    } catch (error) {
      console.error("Error creating contract:", error);
      setSubmitError(error instanceof Error ? error.message : "계약서 생성 중 오류가 발생했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const isStep1Valid = Boolean((isManualEntry ? name.trim() && phone.trim() : clientId !== null) && area);
  const isEmployee1Valid = Boolean(
    isEmployeeManualEntry ? employeeName.trim() && employeePhone.trim() : employeeId !== null
  );
  const isEmployee2Valid = Boolean(
    !showEmployee2 || (isEmployee2ManualEntry ? employee2Name.trim() && employee2Phone.trim() : employee2Id !== null)
  );
  const isStep2Valid = isEmployee1Valid && isEmployee2Valid;
  const isStep3Valid = Boolean(voucherType && voucherDuration && fullPrice && grant && actualPrice);
  // endDate는 이용자 서명 후 직원이 Step 3에서 사후 입력하므로 발급 시점에는 옵셔널.
  const isStep4Valid = Boolean(startDate && paymentDate);
  const isCurrentStepValid = [isStep1Valid, isStep2Valid, isStep3Valid, isStep4Valid][activeStep] ?? true;
  const hasVoucherPricingSelection = Boolean(voucherType && voucherDuration);

  const getStepValidationMessage = (step: number): string | null => {
    if (step === 0 && !isStep1Valid) {
      return "고객 정보와 계약서를 선택해 주세요.";
    }
    if (step === 1 && !isStep2Valid) {
      return "제공인력 정보를 모두 입력해 주세요.";
    }
    if (step === 2 && !isStep3Valid) {
      return "바우처 유형/기간과 금액 정보를 입력해 주세요.";
    }
    if (step === 3 && !isStep4Valid) {
      return "계약 시작일, 결제일을 입력해 주세요.";
    }
    return null;
  };

  const handleStepChange = (nextStep: number) => {
    if (nextStep > activeStep) {
      const validationMessage = getStepValidationMessage(activeStep);
      if (validationMessage) {
        setSubmitError(validationMessage);
        return;
      }
    }
    setSubmitError(null);
    setActiveStep(nextStep);
  };

  const handleWizardComplete = () => {
    const validationMessage = getStepValidationMessage(3);
    if (validationMessage) {
      setSubmitError(validationMessage);
      return;
    }
    void handleContractCreation();
  };

  const wizardSteps: WizardStep[] = [
    {
      label: stepLabels[0] ?? "이용자 정보",
      content: (
        <div className="flex flex-col gap-6">
          {!isManualEntry ? (
            <>
              <ClientAutocomplete
                value={clientId}
                onChange={handleClientSelect}
                label={t(locale, "contract-msg.client-select-label")}
                required
                allowManualEntry
                onManualEntry={handleOpenClientDialog}
              />
              {clientId && (
                <div className="flex flex-col gap-2 pl-3 border-l-[3px] border-primary">
                  <p className="text-sm text-muted-foreground">
                    <strong>{t(locale, "contract-msg.phone-label")}:</strong> {phone || "-"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <strong>{t(locale, "contract-msg.birthday-label")}:</strong> {birthday || "-"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <strong>{t(locale, "contract-msg.address-label")}:</strong> {address || "-"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <strong>{t(locale, "clients.form.due-date")}:</strong> {dueDate || "-"}
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground font-medium">
                  {t(locale, "contract-msg.manual-entry-mode")}
                </span>
                <Button type="button" size="sm" variant="ghost" onClick={handleToggleManualEntry}>
                  {t(locale, "contract-msg.switch-to-search")}
                </Button>
              </div>
              <NameInput
                name={name}
                setName={setName}
                label={t(locale, "contract-msg.name-label")}
                placeholder={t(locale, "contract-msg.name-placeholder")}
              />
              <ContactInput
                phone={phone}
                setPhone={setPhone}
                label={t(locale, "contract-msg.phone-label")}
                placeholder={t(locale, "contract-msg.phone-placeholder")}
              />
              <div className="space-y-2">
                <Label className={LABEL_CLS}>{t(locale, "contract-msg.birthday-label")}</Label>
                <Input
                  variant="v3"
                  value={birthday}
                  onChange={(e) => setBirthday(e.target.value)}
                  placeholder="YYMMDD"
                  className={INPUT_CLS}
                />
              </div>
              <div className="space-y-2">
                <Label className={LABEL_CLS}>{t(locale, "contract-msg.address-label")}</Label>
                <Input
                  variant="v3"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder={t(locale, "contract-msg.address-placeholder")}
                  className={INPUT_CLS}
                />
              </div>
              <div className="space-y-2">
                <Label className={LABEL_CLS}>{t(locale, "clients.form.due-date")}</Label>
                <Input
                  variant="v3"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className={INPUT_CLS}
                />
              </div>
            </>
          )}

          <div className="space-y-2" data-component="contract-creation-doc-type-field">
            <Label className={LABEL_CLS} data-component="contract-creation-doc-type-label">
              {t(locale, "contract-msg.doc-type-label")}
              <span className="text-destructive ml-1">*</span>
            </Label>
            <Select
              value={area}
              onValueChange={setArea}
              disabled={isAreaTemplatesLoading}
              data-component="contract-creation-doc-type-select"
            >
              <SelectTrigger
                className="w-full"
                data-component="contract-creation-doc-type-trigger"
              >
                <SelectValue placeholder={t(locale, "contract-msg.doc-type-label")} />
              </SelectTrigger>
              <SelectContent data-component="contract-creation-doc-type-dropdown">
                {areaTemplates.map((template) => (
                  <SelectItem
                    key={template.areaId}
                    value={template.areaId}
                    data-component="contract-creation-doc-type-option"
                  >
                    {template.templateName || template.areaId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ),
      summary: (
        <div className="flex gap-3 flex-wrap">
          {name && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {name}
            </span>
          )}
          {phone && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {phone}
            </span>
          )}
          {area && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {areaTemplates.find((template) => template.areaId === area)?.templateName || area}
            </span>
          )}
        </div>
      ),
    },
    {
      label: stepLabels[1] ?? "제공인력 정보",
      content: (
        <div className="flex flex-col gap-6">
          {!isEmployeeManualEntry ? (
            <>
              <EmployeeAutocomplete
                value={employeeId}
                onChange={handleEmployeeSelect}
                label={t(locale, "contract-msg.employee-select-label")}
                required
                allowManualEntry
                onManualEntry={handleToggleEmployeeManualEntry}
                excludeIds={employee2Id !== null ? [employee2Id] : []}
              />
              {employeeId !== null && (
                <div className="pl-3 border-l-[3px] border-primary">
                  <p className="text-sm text-muted-foreground">
                    <strong>{t(locale, "contract-msg.employee-phone-label")}:</strong> {employeePhone || "-"}
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground font-medium">
                  {t(locale, "contract-msg.employee-manual-entry-mode")}
                </span>
                <Button type="button" size="sm" variant="ghost" onClick={handleToggleEmployeeManualEntry}>
                  {t(locale, "contract-msg.switch-to-employee-search")}
                </Button>
              </div>
              <NameInput
                name={employeeName}
                setName={setEmployeeName}
                label={t(locale, "contract-msg.employee-name-label")}
                placeholder={t(locale, "contract-msg.employee-name-placeholder")}
              />
              <ContactInput
                phone={employeePhone}
                setPhone={setEmployeePhone}
                label={t(locale, "contract-msg.employee-phone-label")}
                placeholder={t(locale, "contract-msg.employee-phone-placeholder")}
              />
            </>
          )}

          <Separator className="my-1" />
          <div className="flex items-center space-x-2">
            <Checkbox id="add-employee2" checked={showEmployee2} onCheckedChange={handleToggleShowEmployee2} />
            <Label htmlFor="add-employee2" className="cursor-pointer">
              {t(locale, "contract-msg.add-employee2-toggle")}
            </Label>
          </div>

          {showEmployee2 && (
            <div className="flex flex-col gap-6">
              {!isEmployee2ManualEntry ? (
                <>
                  <EmployeeAutocomplete
                    value={employee2Id}
                    onChange={handleEmployee2Select}
                    label={t(locale, "contract-msg.employee2-select-label")}
                    allowManualEntry
                    onManualEntry={handleToggleEmployee2ManualEntry}
                    excludeIds={employeeId !== null ? [employeeId] : []}
                  />
                  {employee2Id !== null && (
                    <div className="pl-3 border-l-[3px] border-secondary">
                      <p className="text-sm text-muted-foreground">
                        <strong>{t(locale, "contract-msg.employee2-phone-label")}:</strong> {employee2Phone || "-"}
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground font-medium">
                      {t(locale, "contract-msg.employee2-manual-entry-mode")}
                    </span>
                    <Button type="button" size="sm" variant="ghost" onClick={handleToggleEmployee2ManualEntry}>
                      {t(locale, "contract-msg.switch-to-employee2-search")}
                    </Button>
                  </div>
                  <NameInput
                    name={employee2Name}
                    setName={setEmployee2Name}
                    label={t(locale, "contract-msg.employee2-name-label")}
                    placeholder={t(locale, "contract-msg.employee-name-placeholder")}
                  />
                  <ContactInput
                    phone={employee2Phone}
                    setPhone={setEmployee2Phone}
                    label={t(locale, "contract-msg.employee2-phone-label")}
                    placeholder={t(locale, "contract-msg.employee-phone-placeholder")}
                  />
                </>
              )}
            </div>
          )}
        </div>
      ),
      summary: (
        <div className="flex gap-3 flex-wrap">
          {(employeeName || employeeId !== null) && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {employeeName || `ID ${employeeId}`}
            </span>
          )}
          {showEmployee2 && (employee2Name || employee2Id !== null) && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {employee2Name || `ID ${employee2Id}`}
            </span>
          )}
        </div>
      ),
    },
    {
      label: stepLabels[2] ?? "바우처 정보",
      content: (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-4">
            <div className="space-y-2 md:w-[120px] md:flex-none">
              <Label className={LABEL_CLS}>{t(locale, "price-info-msg.voucher-year-label")}</Label>
              <select
                className={SELECT_CLS}
                value={String(voucherYear)}
                onChange={(e) => handleVoucherYearChange(Number(e.target.value))}
                disabled={isVoucherYearsLoading}
              >
                {voucherYears.map((year) => (
                  <option key={year} value={String(year)}>
                    {year}년
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2 flex-1 min-w-0">
              <Label className={LABEL_CLS}>{t(locale, "price-info-msg.voucher-type-label")}</Label>
              <div className="relative">
                <select
                  className={`${SELECT_CLS} ${isVoucherPriceInfosLoading ? "bg-none pr-11" : ""}`}
                  value={voucherType}
                  onChange={(e) => handleVoucherTypeChange(e.target.value)}
                >
                  <option value="">{t(locale, "price-info-msg.voucher-type-label")}</option>
                  {Object.entries(voucherOptions.voucherOptions).map(([groupName, types]) => (
                    <optgroup key={groupName} label={groupName}>
                      {Object.entries(types).map(([typeValue, typeData]) => (
                        <option key={typeValue} value={typeValue}>
                          {typeData.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {isVoucherPriceInfosLoading && (
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2">
                    <Spinner className="h-4 w-4 text-primary" />
                  </span>
                )}
              </div>
            </div>

            {voucherType && voucherPriceInfos.length > 0 && (
              <div className="space-y-2 flex-1 min-w-0">
                <Label className={LABEL_CLS}>{t(locale, "price-info-msg.duration-label")}</Label>
                <select
                  className={SELECT_CLS}
                  value={voucherDuration}
                  onChange={(e) => handleDurationChange(e.target.value)}
                  disabled={isVoucherPriceInfosLoading}
                >
                  <option value="">{t(locale, "price-info-msg.duration-label")}</option>
                  {voucherPriceInfos.map((v) => (
                    <option key={v.duration} value={v.duration}>
                      {v.duration}일
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className={LABEL_CLS}>{t(locale, "contract-msg.full-price-label")}</Label>
              <div className="relative">
                <Input
                  variant="v3"
                  value={formatPrice(hasVoucherPricingSelection ? fullPrice : 0)}
                  onChange={(e) => setFullPrice(parsePrice(e.target.value))}
                  placeholder="0"
                  className={`${INPUT_CLS} pr-12`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">원</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label className={LABEL_CLS}>{t(locale, "contract-msg.grant-label")}</Label>
              <div className="relative">
                <Input
                  variant="v3"
                  value={formatPrice(hasVoucherPricingSelection ? grant : 0)}
                  onChange={(e) => setGrant(parsePrice(e.target.value))}
                  placeholder="0"
                  className={`${INPUT_CLS} pr-12`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">원</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label className={LABEL_CLS}>{t(locale, "contract-msg.actual-price-label")}</Label>
              <div className="relative">
                <Input
                  variant="v3"
                  value={formatPrice(hasVoucherPricingSelection ? actualPrice : 0)}
                  onChange={(e) => setActualPrice(parsePrice(e.target.value))}
                  placeholder="0"
                  className={`${INPUT_CLS} pr-12`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">원</span>
              </div>
            </div>
          </div>
        </div>
      ),
      summary: (
        <div className="flex gap-3 flex-wrap">
          {voucherType && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {voucherType}
            </span>
          )}
          {voucherDuration && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {voucherDuration}일
            </span>
          )}
          {hasVoucherPricingSelection && actualPrice && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {formatPrice(actualPrice)}원
            </span>
          )}
        </div>
      ),
    },
    {
      label: stepLabels[3] ?? "계약 정보",
      content: (
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-4">
          <div className="space-y-2 flex-1 min-w-0">
            <Label className={LABEL_CLS}>{t(locale, "contract-msg.start-date-label")}</Label>
            <Input
              variant="v3"
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              placeholder="YYMMDD"
              value={startDateInput}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
                setStartDateInput(digits);
                setStartDate(yymmddToIso(digits));
              }}
              className={INPUT_CLS}
            />
          </div>
          <div className="space-y-2 flex-1 min-w-0">
            <Label className={LABEL_CLS}>{t(locale, "contract-msg.end-date-label")}</Label>
            <Input
              variant="v3"
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              placeholder="YYMMDD"
              value={endDateInput}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
                setEndDateInput(digits);
                setEndDate(yymmddToIso(digits));
              }}
              className={INPUT_CLS}
            />
          </div>
          <div className="space-y-2 flex-1 min-w-0">
            <Label className={LABEL_CLS}>{t(locale, "contract-msg.payment-date-label")}</Label>
            <Input
              variant="v3"
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              placeholder="YYMMDD"
              value={paymentDateInput}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
                setPaymentDateInput(digits);
                setPaymentDate(yymmddToIso(digits));
              }}
              className={INPUT_CLS}
            />
          </div>
        </div>
      ),
      summary: (
        <div className="flex gap-3 flex-wrap">
          {startDate && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {startDate} ~ {endDate || "(직원 입력 예정)"}
            </span>
          )}
          {paymentDate && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              결제일 {paymentDate}
            </span>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <div data-component="messages-contract-form" className="space-y-4">
        <SteppedWizard
          title={t(locale, "msg-type.contract")}
          subtitle={t(locale, "contract-msg.subtitle")}
          steps={wizardSteps}
          currentStep={activeStep}
          onStepChange={handleStepChange}
          onComplete={handleWizardComplete}
          onBack={() => router.push("/contracts")}
          backLabel="전자문서 목록으로 돌아가기"
          completeLabel={isSubmitting ? "처리 중..." : t(locale, "contract-msg.contract-creation")}
          isSubmitting={isSubmitting}
          isNextDisabled={!isCurrentStepValid}
        />

        {(submitError || eformsignError) && (
          <Alert variant="destructive" data-component="messages-contract-form-error">
            <AlertDescription>{submitError || eformsignError}</AlertDescription>
          </Alert>
        )}

        {isEformsignLoading && (
          <Alert data-component="messages-contract-form-loading">
            <AlertDescription>eformsign SDK를 로드하는 중입니다...</AlertDescription>
          </Alert>
        )}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={(open: boolean) => !open && handleDialogClose()}>
        <DialogContent
          data-component="messages-contract-form-dialog"
          // Mobile: full-screen. Desktop (lg+): A4 portrait + eformsign 상하단 툴바 비율(약 0.73 w/h)을 맞춰 800×1102px 고정,
          // 단 viewport이 작으면 95vh로 캡. flex column으로 헤더 + 남은 공간을 iframe이 차지하도록 한다.
          className="max-w-full w-screen h-screen p-0 gap-0 flex flex-col lg:w-[800px] lg:max-w-[800px] lg:h-[1102px] lg:max-h-[95vh] lg:rounded-lg"
        >
          <DialogHeader className="px-4 py-2 flex flex-row items-center justify-between border-b shrink-0">
            <DialogTitle>계약서 작성</DialogTitle>
            <Button type="button" variant="ghost" size="icon" onClick={handleDialogClose} className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-hidden">
            <iframe id="eformsign_iframe" className="w-full h-full border-none" title="eformsign Document" />
          </div>
        </DialogContent>
      </Dialog>

      <ClientFormDialog
        open={isClientDialogOpen}
        onClose={() => setIsClientDialogOpen(false)}
        onSuccess={handleClientCreated}
      />
    </>
  );
};
