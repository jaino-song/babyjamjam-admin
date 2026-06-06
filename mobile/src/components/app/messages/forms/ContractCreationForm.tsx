"use client";
import dayjs from "dayjs";
import "dayjs/locale/ko";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { t } from "@/lib/i18n/translations";
import { useFormStore } from "@/stores/form-store";
import { useLocale } from "@/providers/LocaleProvider";
import { eformsignApi } from "@/services/api";
import { buildInitialSignRequestDocRecord } from "@/lib/eformsign/document-record";
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
import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useEformsign } from "@/hooks/useEformsign";
import type { EformsignDocumentOption } from "@/lib/eformsign/types";
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
  fullPrice: string;
  grant: string;
  actualPrice: string;
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

const SELECT_CLS =
  "w-full px-4 py-3 rounded-2xl border-[1.5px] border-v3-border bg-white text-[0.85rem] font-[Pretendard] text-v3-dark outline-none transition-all focus:border-v3-primary focus:shadow-[0_0_0_3px_hsla(214,100%,34%,0.08)] appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_12px_center]";

const MANUAL_CLIENT_CREATION_CONFIRM_MESSAGE =
  "선택된 기존 고객이 없습니다. 입력한 이용자 정보를 새 고객으로 등록한 뒤 계약서를 생성할까요?";

// // Set Korean as the global locale
// dayjs.locale("ko");

export const ContractCreationForm = () => {
  const router = useRouter();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [activeStep, setActiveStep] = useState(0);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [documentCreated, setDocumentCreated] = useState(false);

  // State for client creation dialog
  const [isClientDialogOpen, setIsClientDialogOpen] = useState(false);

  const { isLoaded: isEformsignLoaded, isLoading: isEformsignLoading, error: eformsignError, openDocument } = useEformsign();

  const {
    // Client selection
    clientId,
    isManualEntry,
    name,
    phone,
    birthday,
    address,
    dueDate,
    // Employee 1 selection
    employeeId,
    isEmployeeManualEntry,
    employeeName,
    employeePhone,
    // Employee 2 selection
    showEmployee2,
    employee2Id,
    isEmployee2ManualEntry,
    employee2Name,
    employee2Phone,
    // Contract details
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
    // Client selection setters
    setClientId,
    setIsManualEntry,
    setName,
    setPhone,
    setBirthday,
    setAddress,
    setDueDate,
    resetClientFields,
    // Employee 1 selection setters
    setIsEmployeeManualEntry,
    setEmployeeName,
    setEmployeePhone,
    setEmployeeSelection,
    resetEmployeeFields,
    // Employee 2 selection setters
    setShowEmployee2,
    setIsEmployee2ManualEntry,
    setEmployee2Name,
    setEmployee2Phone,
    setEmployee2Selection,
    resetEmployee2Fields,
    // Contract details setters
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

  // Voucher price info query - fetches price data based on selected voucher type
  const { data: voucherPriceInfos = [], isLoading: isVoucherPriceInfosLoading } = useVoucherPriceInfos(voucherType, voucherYear);

  // Area templates query - fetches area-to-template mappings
  const { data: areaTemplates = [], isLoading: isAreaTemplatesLoading } = useAreaTemplates();

  // Voucher years query - fetches available years for voucher selection
  const { data: voucherYears = [], isLoading: isVoucherYearsLoading } = useVoucherYears();

  // Employees query - fetches employees for auto-population
  const { data: employees } = useEmployees();

  // Client creation mutation - for creating new clients from manual entry
  const createClientMutation = useCreateClient();

  // Ref to store selected client for delayed employee auto-population
  const selectedClientRef = useRef<Client | null>(null);

  // Cast the result of t() to string[] because the translation returns an array for this key
  const stepLabels = t(locale, "contract-msg.pagination-steps") as unknown as string[];

  // Voucher year change handler - resets type, duration, and prices when year changes
  const handleVoucherYearChange = (value: number) => {
    setVoucherYear(value);
    setVoucherType("");
    setVoucherDuration("");
    setFullPrice("");
    setGrant("");
    setActualPrice("");
  };

  // Voucher type change handler - resets duration and prices when type changes
  const handleVoucherTypeChange = (value: string) => {
    setVoucherType(value);
    setVoucherDuration("");
    setFullPrice("");
    setGrant("");
    setActualPrice("");
  };

  // Voucher duration change handler - auto-populates price fields
  const handleDurationChange = (duration: string) => {
    const selectedVoucher = voucherPriceInfos.find(v => v.duration === duration);
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
      // Reset form or navigate away after successful document creation
      setDocumentCreated(false);
    }
  };

  // Client selection handlers
  const handleClientSelect = (selectedClientId: number | null, client: Client | null) => {
    setClientId(selectedClientId);

    // Store client in ref for delayed employee auto-population (useEffect handles this)
    selectedClientRef.current = client;

    if (client) {
      // Auto-populate fields from selected client
      setName(client.name);
      setPhone(client.phone || "");
      setBirthday(client.birthday || "");
      setAddress(client.address || "");
      setDueDate(client.dueDate || "");

      // Auto-populate voucher info from client if available
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
      // Auto-populate contract dates if available
      if (client.startDate) {
        setStartDate(client.startDate);
        // Default payment date to start date
        setPaymentDate(client.startDate);
      }
      if (client.endDate) {
        setEndDate(client.endDate);
      }

      // Auto-populate primary employee if employees are already loaded
      // (useEffect handles the case when employees load after client selection)
      if (client.primaryEmployee && employees) {
        const primaryEmp = employees.find(e => e.id === client.primaryEmployee?.id);
        if (primaryEmp) {
          setEmployeeSelection(primaryEmp.id, primaryEmp.name, primaryEmp.phone);
          setIsEmployeeManualEntry(false);
        }
      }

      // Auto-populate secondary employee if employees are already loaded
      if (client.secondaryEmployee && employees) {
        const secondaryEmp = employees.find(e => e.id === client.secondaryEmployee?.id);
        if (secondaryEmp) {
          setShowEmployee2(true);
          setEmployee2Selection(secondaryEmp.id, secondaryEmp.name, secondaryEmp.phone);
          setIsEmployee2ManualEntry(false);
        }
      }
    } else {
      // Clear fields when client is deselected
      setName("");
      setPhone("");
      setBirthday("");
      setAddress("");
      setDueDate("");
      // Also clear voucher info
      setVoucherType("");
      setVoucherDuration("");
      setFullPrice("");
      setGrant("");
      setActualPrice("");
      setStartDate("");
      setEndDate("");
      // Also clear employee info
      resetEmployeeFields();
      resetEmployee2Fields();
    }
  };

  const handleToggleManualEntry = () => {
    resetClientFields();
    setIsManualEntry(!isManualEntry);
  };

  // Handler to open client dialog from autocomplete
  const handleOpenClientDialog = () => {
    setIsClientDialogOpen(true);
  };

  // Handler when a client is created from the dialog
  const handleClientCreated = (newClient: Client) => {
    handleClientSelect(newClient.id, newClient);
  };

  // Employee selection handlers
  const handleEmployeeSelect = (selectedEmployeeId: number | null, employee: Employee | null) => {
    if (employee) {
      // Batch update all employee fields atomically to prevent intermediate render states
      setEmployeeSelection(selectedEmployeeId, employee.name, employee.phone);
    } else {
      // Clear all employee fields atomically
      setEmployeeSelection(null, "", "");
    }
  };

  const handleToggleEmployeeManualEntry = () => {
    resetEmployeeFields();
    setIsEmployeeManualEntry(!isEmployeeManualEntry);
  };

  // Employee 2 selection handlers
  const handleEmployee2Select = (selectedEmployeeId: number | null, employee: Employee | null) => {
    if (employee) {
      // Batch update all employee 2 fields atomically to prevent intermediate render states
      setEmployee2Selection(selectedEmployeeId, employee.name, employee.phone);
    } else {
      // Clear all employee 2 fields atomically
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
      // If hiding, reset all employee 2 fields
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
      // Determine final clientId - create new client if in manual entry mode
      let finalClientId = clientId;

      if (isManualEntry && !clientId) {
        if (!window.confirm(MANUAL_CLIENT_CREATION_CONFIRM_MESSAGE)) {
          return;
        }

        // Create new client from manual entry data
        const newClient = await createClientMutation.mutateAsync({
          name,
          phone,
          birthday: birthday || undefined,
          address: address || undefined,
          dueDate: dueDate || startDate || undefined,
          primaryEmployeeId: null,
          careCenter: false,
          voucherClient: true,
          breastPump: false,
          suppressGreetingSms: true,
        });
        finalClientId = newClient.id;
        setClientId(newClient.id);
      }

      // Authenticate first - tokens are stored in httpOnly cookies
      const executionTime = Date.now();
      const authResult = await eformsignApi.authenticate(executionTime);

      if (!authResult.success) {
        throw new Error("Failed to authenticate");
      }

      const start = dayjs(startDate);
      const end = dayjs(endDate);
      const payment = dayjs(paymentDate);

      const contractData: ContractDataDto = {
        customerName: name,
        customerContact: phone,
        customerDOB: birthday,
        customerAddress: address,
        caretaker1Name: employeeName,
        caretaker1Contact: employeePhone,
        type: voucherType,
        days: voucherDuration,
        area,
        contractDuration: `${start.format("YYYY-MM-DD")} ~ ${end.format("YYYY-MM-DD")}`,
        startYear: start.format("YY"),
        startMonth: start.format("MM"),
        startDay: start.format("DD"),
        startDate: startDate,
        endYear: end.format("YY"),
        endMonth: end.format("MM"),
        endDay: end.format("DD"),
        endDate: endDate,
        paymentYear: payment.format("YY"),
        paymentMonth: payment.format("MM"),
        paymentDay: payment.format("DD"),
        fullPrice: fullPrice,
        grant: grant,
        actualPrice: actualPrice,
      };

      // Get document options from backend (tokens are read from cookies)
      // Pass clientId to link the document with the client
      const documentOption: EformsignDocumentOption = await eformsignApi.generateDocument(
        contractData,
        finalClientId ?? undefined
      );

      console.log("Document option generated:", documentOption);

      // Open the dialog first
      setIsDialogOpen(true);

      // Wait a tick for the dialog/iframe to render
      setTimeout(() => {
        openDocument(documentOption, "eformsign_iframe", {
          onSuccess: async (response) => {
            console.log("Document created successfully:", response);

            // Create eformsign_doc record to track the document and link to client
            if (finalClientId && response.document_id) {
              try {
                await eformsignApi.createDocRecord(buildInitialSignRequestDocRecord({
                  documentId: response.document_id,
                  clientId: finalClientId,
                  stepRecipientName: name,
                  stepRecipientSms: phone,
                  expiredDate: end.add(30, "day").toISOString(),
                  linkToClient: true, // Also update client.e_doc_id for tracking
                }));
              } catch (docError) {
                console.error("Failed to create eformsign doc record:", docError);
                // Don't fail the whole operation if doc record creation fails
              }
            }

            queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.allDocuments() });
            setDocumentCreated(true);
            alert(`계약서가 성공적으로 생성되었습니다.`);
            handleDialogClose();
          },
          onError: (response) => {
            console.error("Document creation failed:", response);
            setSubmitError(`문서 생성 실패: ${response.message}`);
            handleDialogClose();
          },
          onAction: (response) => {
            console.log("Document action:", response);
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
  const isStep4Valid = Boolean(startDate && endDate && paymentDate);
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
      return "계약 시작일, 종료일, 본인부담금 수령 날짜를 입력해 주세요.";
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
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleToggleManualEntry}
                >
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
                <Label>{t(locale, "contract-msg.birthday-label")}</Label>
                <Input
                  value={birthday}
                  onChange={(e) => setBirthday(e.target.value)}
                  placeholder="YYMMDD"
                  className="bg-background"
                />
              </div>
              <div className="space-y-2">
                <Label>{t(locale, "contract-msg.address-label")}</Label>
                <Input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder={t(locale, "contract-msg.address-placeholder")}
                  className="bg-background"
                />
              </div>
              <div className="space-y-2">
                <Label>{t(locale, "clients.form.due-date")}</Label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="bg-background"
                />
              </div>
            </>
          )}

          <div className="space-y-2" data-component="contract-creation-doc-type-field">
            <Label data-component="contract-creation-doc-type-label">
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
                className="w-full bg-white text-[0.85rem] font-[Pretendard] text-v3-dark"
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
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleToggleEmployeeManualEntry}
                >
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
            <Checkbox
              id="add-employee2"
              checked={showEmployee2}
              onCheckedChange={handleToggleShowEmployee2}
            />
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
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={handleToggleEmployee2ManualEntry}
                    >
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
              <Label>{t(locale, "price-info-msg.voucher-year-label")}</Label>
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
              <Label>{t(locale, "price-info-msg.voucher-type-label")}</Label>
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
                <Label>{t(locale, "price-info-msg.duration-label")}</Label>
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
              <Label>{t(locale, "contract-msg.full-price-label")}</Label>
              <div className="relative">
                <Input
                  value={formatPrice(hasVoucherPricingSelection ? fullPrice : 0)}
                  onChange={(e) => setFullPrice(parsePrice(e.target.value))}
                  placeholder={t(locale, "contract-msg.price-placeholder")}
                  className="bg-background pr-12"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  원
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t(locale, "contract-msg.grant-label")}</Label>
              <div className="relative">
                <Input
                  value={formatPrice(hasVoucherPricingSelection ? grant : 0)}
                  onChange={(e) => setGrant(parsePrice(e.target.value))}
                  placeholder={t(locale, "contract-msg.price-placeholder")}
                  className="bg-background pr-12"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  원
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t(locale, "contract-msg.actual-price-label")}</Label>
              <div className="relative">
                <Input
                  value={formatPrice(hasVoucherPricingSelection ? actualPrice : 0)}
                  onChange={(e) => setActualPrice(parsePrice(e.target.value))}
                  placeholder={t(locale, "contract-msg.price-placeholder")}
                  className="bg-background pr-12"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  원
                </span>
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
            <Label>{t(locale, "contract-msg.start-date-label")}</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-background"
            />
          </div>
          <div className="space-y-2 flex-1 min-w-0">
            <Label>{t(locale, "contract-msg.end-date-label")}</Label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-background"
            />
          </div>
          <div className="space-y-2 flex-1 min-w-0">
            <Label>{t(locale, "contract-msg.payment-date-label")}</Label>
            <Input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className="bg-background"
            />
          </div>
        </div>
      ),
      summary: (
        <div className="flex gap-3 flex-wrap">
          {startDate && endDate && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {startDate} ~ {endDate}
            </span>
          )}
          {paymentDate && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              본인부담금 수령일 {paymentDate}
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
          className="max-w-full w-screen h-screen p-0 gap-0"
        >
          <DialogHeader className="px-4 py-2 flex flex-row items-center justify-between border-b">
            <DialogTitle>계약서 작성</DialogTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleDialogClose}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </DialogHeader>
          <div className="flex-1 overflow-hidden" style={{ height: "calc(100vh - 64px)" }}>
            <iframe
              id="eformsign_iframe"
              className="w-full h-full border-none"
              title="eformsign Document"
            />
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
