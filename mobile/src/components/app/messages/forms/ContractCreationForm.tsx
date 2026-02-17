"use client";
import dayjs from "dayjs";
import "dayjs/locale/ko";
import { X } from "lucide-react";
import { ContentPaper } from "@/components/app/root/content-paper";
import { t } from "@/lib/i18n/translations";
import { useFormStore } from "@/stores/form-store";
import { useLocale } from "@/providers/LocaleProvider";
import { eformsignApi } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Stepper, Step } from "@/components/ui/stepper";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState, useEffect, useRef } from "react";
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
  receiptYear: string;
  receiptMonth: string;
  receiptDay: string;
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

// // Set Korean as the global locale
// dayjs.locale("ko");

export const ContractCreationForm = () => {
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
  const steps = t(locale, "contract-msg.pagination-steps") as unknown as string[];

  const handleStepBack = () => {
    setActiveStep((prevActiveStep) => prevActiveStep - 1);
  };

  const handleStepNext = () => {
    setActiveStep((prevActiveStep) => prevActiveStep + 1);
  };

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
        // Create new client from manual entry data
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

      // Authenticate first - tokens are stored in httpOnly cookies
      const executionTime = Date.now();
      const authResult = await eformsignApi.authenticate(executionTime);

      if (!authResult.success) {
        throw new Error("Failed to authenticate");
      }

      const start = dayjs(startDate);
      const end = dayjs(endDate);
      const payment = dayjs(paymentDate);
      const today = dayjs();

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
        receiptYear: today.format("YY"),
        receiptMonth: today.format("MM"),
        receiptDay: today.format("DD"),
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
                await eformsignApi.createDocRecord({
                  documentId: response.document_id,
                  clientId: finalClientId,
                  statusType: "060", // 대기
                  statusDetail: "대기",
                  stepType: "01",
                  stepIndex: "1",
                  stepName: "서명 요청",
                  stepRecipientType: "01",
                  stepRecipientName: name,
                  stepRecipientSms: phone,
                  expiredDate: end.add(30, "day").toISOString(),
                  linkToClient: true, // Also update client.e_doc_id for tracking
                });
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

  // Validation logic for each step
  // Step 0: Either a client is selected OR manual entry fields are filled, AND area is selected
  const isStep1Valid = (isManualEntry
    ? (name && phone)
    : clientId !== null) && area;
  // Step 1: Employee 1 must be valid, and if Employee 2 toggle is on, Employee 2 must also be valid
  const isEmployee1Valid = isEmployeeManualEntry
    ? (employeeName && employeePhone)
    : employeeId !== null;
  const isEmployee2Valid = !showEmployee2 || (isEmployee2ManualEntry
    ? (employee2Name && employee2Phone)
    : employee2Id !== null);
  const isStep2Valid = isEmployee1Valid && isEmployee2Valid;
  // Step 2: Voucher info - type, duration, and prices must be selected/filled
  const isStep3Valid = voucherType && voucherDuration && fullPrice && grant && actualPrice;
  // Step 3: Contract dates must be selected
  const isStep4Valid = startDate && endDate && paymentDate;

  const isNextDisabled = () => {
    if (activeStep === 0) return !isStep1Valid;
    if (activeStep === 1) return !isStep2Valid;
    if (activeStep === 2) return !isStep3Valid;
    return false;
  };

  return (
    <>
      <ContentPaper
        data-component="messages-contract-form"
        className="flex flex-col justify-start grow w-full bg-background"
      >
        <div className="flex flex-col h-full animate-fade-in">
          {/* title */}
          <h2 className="text-xl font-bold text-primary mb-2">
            {t(locale, "msg-type.contract")}
          </h2>
          {/* subtitle */}
          <p className="text-sm text-muted-foreground mb-6">
            {t(locale, "contract-msg.subtitle")}
          </p>

          {/* Stepper */}
          <Stepper activeStep={activeStep} className="mb-8">
            {steps.map((label, index) => (
              <Step key={label}>
                <span className="text-xs whitespace-pre-line text-center">{label}</span>
              </Step>
            ))}
          </Stepper>

          {/* form */}
          <Card data-component="messages-contract-form-card" className="grow overflow-auto border-0 shadow-none">
            <CardContent className="bg-background p-0">
                {/* Step 0: User Info */}
                {activeStep === 0 && (
                  <div className="flex flex-col gap-6 animate-fade-in">
                    {!isManualEntry ? (
                      <>
                        {/* Client selection mode */}
                        <ClientAutocomplete
                          value={clientId}
                          onChange={handleClientSelect}
                          label={t(locale, "contract-msg.client-select-label")}
                          required
                          allowManualEntry
                          onManualEntry={handleOpenClientDialog}
                        />
                        {/* Show selected client info (read-only) */}
                        {clientId && (
                          <div className="flex flex-col gap-2 pl-3 border-l-[3px] border-primary animate-fade-in">
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
                        {/* Manual entry mode */}
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-muted-foreground font-medium">
                            {t(locale, "contract-msg.manual-entry-mode")}
                          </span>
                          <Button
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
                    {/* 지역 선택 (계약서 템플릿) */}
                    <div className="space-y-2">
                      <Label>
                        {t(locale, "contract-msg.doc-type-label")}
                        <span className="text-destructive ml-1">*</span>
                      </Label>
                      <Select
                        value={area || undefined}
                        onValueChange={setArea}
                        disabled={isAreaTemplatesLoading}
                      >
                        <SelectTrigger className="bg-background">
                          <SelectValue placeholder={t(locale, "contract-msg.doc-type-label")} />
                        </SelectTrigger>
                        <SelectContent>
                          {areaTemplates.map((template) => (
                            <SelectItem key={template.areaId} value={template.areaId}>
                              {template.templateName || template.areaId}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {/* Step 1: Provider Info */}
                {activeStep === 1 && (
                  <div className="flex flex-col gap-6 animate-fade-in">
                    {/* Employee 1 Section */}
                    {!isEmployeeManualEntry ? (
                      <>
                        {/* 바우처 유형 선택 */}
                        <div className="space-y-2">
                          <Label>{t(locale, "price-info-msg.voucher-type-label")}</Label>
                          <Select
                            value={voucherType || undefined}
                            onValueChange={handleVoucherTypeChange}
                          >
                            <SelectTrigger className="bg-background">
                              <SelectValue placeholder={t(locale, "price-info-msg.voucher-type-label")} />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(voucherOptions.voucherOptions).map(([groupName, types]) => (
                                <div key={groupName}>
                                  <div className="px-2 py-1.5 text-sm font-semibold text-muted-foreground">
                                    {groupName}
                                  </div>
                                  {Object.entries(types).map(([typeValue, typeData]) => (
                                    <SelectItem key={typeValue} value={typeValue} className="pl-6">
                                      {typeData.label}
                                    </SelectItem>
                                  ))}
                                </div>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* 바우처 기간 선택 - 유형 선택 후에만 표시 */}
                        {voucherType && voucherPriceInfos.length > 0 && (
                          <div className="flex flex-row gap-4 animate-fade-in">
                            <div className="space-y-2 min-w-[100px]">
                              <Label>연도</Label>
                              <Select
                                value={String(voucherYear)}
                                onValueChange={(value: string) => handleVoucherYearChange(Number(value))}
                              >
                                <SelectTrigger className="bg-background">
                                  <SelectValue placeholder="연도" />
                                </SelectTrigger>
                                <SelectContent>
                                  {[voucherYear - 1, voucherYear, voucherYear + 1].map((year) => (
                                    <SelectItem key={year} value={String(year)}>
                                      {year}년
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2 flex-1">
                              <Label>{t(locale, "price-info-msg.duration-label")}</Label>
                              <Select
                                value={voucherDuration || undefined}
                                onValueChange={handleDurationChange}
                                disabled={isVoucherPriceInfosLoading}
                              >
                                <SelectTrigger className="bg-background">
                                  <SelectValue placeholder={t(locale, "price-info-msg.duration-label")} />
                                </SelectTrigger>
                                <SelectContent>
                                  {voucherPriceInfos.map((v) => (
                                    <SelectItem key={v.duration} value={v.duration}>
                                      {v.duration}일
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        )}

                        {/* 로딩 표시 */}
                        {voucherType && isVoucherPriceInfosLoading && (
                          <div className="pl-3 border-l-[3px] border-primary animate-fade-in">
                            <p className="text-sm text-muted-foreground">
                              <strong>{t(locale, "contract-msg.employee-phone-label")}:</strong> {employeePhone || "-"}
                            </p>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        {/* 서비스 금액 */}
                        <div className="space-y-2 animate-fade-in">
                          <Label>{t(locale, "contract-msg.full-price-label")}</Label>
                          <div className="relative">
                            <Input
                              value={formatPrice(fullPrice)}
                              onChange={(e) => setFullPrice(parsePrice(e.target.value))}
                              placeholder={t(locale, "contract-msg.price-placeholder")}
                              className="bg-background pr-12"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                              원
                            </span>
                          </div>
                        </div>
                        {/* 정부지원금 */}
                        <div className="space-y-2 animate-fade-in">
                          <Label>{t(locale, "contract-msg.grant-label")}</Label>
                          <div className="relative">
                            <Input
                              value={formatPrice(grant)}
                              onChange={(e) => setGrant(parsePrice(e.target.value))}
                              placeholder={t(locale, "contract-msg.price-placeholder")}
                              className="bg-background pr-12"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                              원
                            </span>
                          </div>
                        </div>
                        {/* 본인부담금 */}
                        <div className="space-y-2 animate-fade-in">
                          <Label>{t(locale, "contract-msg.actual-price-label")}</Label>
                          <div className="relative">
                            <Input
                              value={formatPrice(actualPrice)}
                              onChange={(e) => setActualPrice(parsePrice(e.target.value))}
                              placeholder={t(locale, "contract-msg.price-placeholder")}
                              className="bg-background pr-12"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                              원
                            </span>
                          </div>
                        </div>
                        {/* 계약 시작일 */}
                        <div className="space-y-2 animate-fade-in">
                          <Label>{t(locale, "contract-msg.start-date-label")}</Label>
                          <Input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="bg-background"
                          />
                        </div>
                        {/* 계약 종료일 */}
                        <div className="space-y-2 animate-fade-in">
                          <Label>{t(locale, "contract-msg.end-date-label")}</Label>
                          <Input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="bg-background"
                          />
                        </div>
                        {/* 본인부담금 결제일 */}
                        <div className="space-y-2 animate-fade-in">
                          <Label>{t(locale, "contract-msg.payment-date-label")}</Label>
                          <Input
                            type="date"
                            value={paymentDate}
                            onChange={(e) => setPaymentDate(e.target.value)}
                            className="bg-background"
                          />
                        </div>
                      </>
                    )}

                    {/* Employee 2 Toggle */}
                    <Separator className="my-1" />
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="add-employee2"
                        checked={showEmployee2}
                        onCheckedChange={(checked) => {
                          if (checked === true) {
                            handleToggleShowEmployee2();
                          } else if (!checked) {
                            handleToggleShowEmployee2();
                          }
                        }}
                      />
                      <Label htmlFor="add-employee2" className="cursor-pointer">
                        {t(locale, "contract-msg.add-employee2-toggle")}
                      </Label>
                    </div>

                    {/* Employee 2 Section */}
                    {showEmployee2 && (
                      <div className="flex flex-col gap-6 animate-fade-in">
                        {!isEmployee2ManualEntry ? (
                          <>
                            {/* Employee 2 selection mode */}
                            <EmployeeAutocomplete
                              value={employee2Id}
                              onChange={handleEmployee2Select}
                              label={t(locale, "contract-msg.employee2-select-label")}
                              allowManualEntry
                              onManualEntry={handleToggleEmployee2ManualEntry}
                              excludeIds={employeeId !== null ? [employeeId] : []}
                            />
                            {/* Show selected employee 2 info (read-only) */}
                            {employee2Id !== null && (
                              <div className="pl-3 border-l-[3px] border-secondary animate-fade-in">
                                <p className="text-sm text-muted-foreground">
                                  <strong>{t(locale, "contract-msg.employee2-phone-label")}:</strong> {employee2Phone || "-"}
                                </p>
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            {/* Employee 2 manual entry mode */}
                            <div className="flex justify-between items-center">
                              <span className="text-sm text-muted-foreground font-medium">
                                {t(locale, "contract-msg.employee2-manual-entry-mode")}
                              </span>
                              <Button
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
                )}

                {/* Step 2: Voucher Info (바우처 정보) */}
                {activeStep === 2 && (
                  <div className="flex flex-col gap-6 animate-fade-in">
                    {/* 바우처 연도 선택 */}
                    <div className="space-y-2 max-w-[120px]">
                      <Label>{t(locale, "price-info-msg.voucher-year-label")}</Label>
                      <Select
                        value={String(voucherYear)}
                        onValueChange={(value: string) => handleVoucherYearChange(Number(value))}
                        disabled={isVoucherYearsLoading}
                      >
                        <SelectTrigger className="bg-background">
                          <SelectValue placeholder={t(locale, "price-info-msg.voucher-year-label")} />
                        </SelectTrigger>
                        <SelectContent>
                          {voucherYears.map((year) => (
                            <SelectItem key={year} value={String(year)}>
                              {year}년
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* 바우처 유형 선택 */}
                    <div className="space-y-2">
                      <Label>{t(locale, "price-info-msg.voucher-type-label")}</Label>
                      <Select
                        value={voucherType || undefined}
                        onValueChange={handleVoucherTypeChange}
                      >
                        <SelectTrigger className="bg-background">
                          <SelectValue placeholder={t(locale, "price-info-msg.voucher-type-label")} />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(voucherOptions.voucherOptions).map(([groupName, types]) => (
                            <div key={groupName}>
                              <div className="px-2 py-1.5 text-sm font-semibold text-muted-foreground">
                                {groupName}
                              </div>
                              {Object.entries(types).map(([typeValue, typeData]) => (
                                <SelectItem key={typeValue} value={typeValue} className="pl-6">
                                  {typeData.label}
                                </SelectItem>
                              ))}
                            </div>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* 바우처 기간 선택 - 유형 선택 후에만 표시 */}
                    {voucherType && voucherPriceInfos.length > 0 && (
                      <div className="space-y-2 animate-fade-in">
                        <Label>{t(locale, "price-info-msg.duration-label")}</Label>
                        <Select
                          value={voucherDuration || undefined}
                          onValueChange={handleDurationChange}
                          disabled={isVoucherPriceInfosLoading}
                        >
                          <SelectTrigger className="bg-background">
                            <SelectValue placeholder={t(locale, "price-info-msg.duration-label")} />
                          </SelectTrigger>
                          <SelectContent>
                            {voucherPriceInfos.map((v) => (
                              <SelectItem key={v.duration} value={v.duration}>
                                {v.duration}일
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* 로딩 표시 */}
                    {voucherType && isVoucherPriceInfosLoading && (
                      <div className="flex justify-center animate-fade-in">
                        <Spinner className="h-5 w-5 text-primary" />
                      </div>
                    )}

                    {/* 가격 정보 - 기간 선택 후 표시 */}
                    {voucherDuration && fullPrice && grant && actualPrice && (
                      <div className="flex flex-col gap-2 animate-fade-in">
                        <Separator className="my-1" />
                        <p className="text-base font-medium">
                          {t(locale, "contract-msg.full-price-label")}: {formatPrice(fullPrice)}원
                        </p>
                        <p className="text-base font-medium">
                          {t(locale, "contract-msg.grant-label")}: {formatPrice(grant)}원
                        </p>
                        <p className="text-base font-medium">
                          {t(locale, "contract-msg.actual-price-label")}: {formatPrice(actualPrice)}원
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Step 3: Contract Info (계약 정보) */}
                {activeStep === 3 && (
                  <div className="flex flex-col gap-6 animate-fade-in">
                    {/* 계약 시작일 */}
                    <div className="space-y-2 animate-fade-in">
                      <Label>{t(locale, "contract-msg.start-date-label")}</Label>
                      <Input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="bg-background"
                      />
                    </div>
                    {/* 계약 종료일 */}
                    <div className="space-y-2 animate-fade-in" style={{ animationDelay: "100ms" }}>
                      <Label>{t(locale, "contract-msg.end-date-label")}</Label>
                      <Input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="bg-background"
                      />
                    </div>
                    {/* 본인부담금 결제일 */}
                    <div className="space-y-2 animate-fade-in" style={{ animationDelay: "200ms" }}>
                      <Label>{t(locale, "contract-msg.payment-date-label")}</Label>
                      <Input
                        type="date"
                        value={paymentDate}
                        onChange={(e) => setPaymentDate(e.target.value)}
                        className="bg-background"
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Error Messages */}
            {(submitError || eformsignError) && (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>{submitError || eformsignError}</AlertDescription>
              </Alert>
            )}

            {/* Loading indicator for eformsign SDK */}
            {isEformsignLoading && (
              <Alert className="mt-4">
                <AlertDescription>eformsign SDK를 로드하는 중입니다...</AlertDescription>
              </Alert>
            )}

            {/* Navigation Buttons */}
            <div className="flex flex-row justify-between gap-4 mt-6">
              <Button
                variant="outline"
                onClick={handleStepBack}
                disabled={activeStep === 0 || isSubmitting}
                data-component="messages-contract-form-back"
              >
                {t(locale, "common.back")}
              </Button>

              {activeStep === steps.length - 1 ? (
                <Button
                  onClick={handleContractCreation}
                  disabled={!isStep4Valid || isSubmitting || !isEformsignLoaded}
                >
                  {isSubmitting && <Spinner className="mr-2 h-4 w-4" />}
                  {isSubmitting ? "처리 중..." : t(locale, "contract-msg.contract-creation")}
                </Button>
              ) : (
                <Button
                  onClick={handleStepNext}
                  disabled={isNextDisabled()}
                  data-component="messages-contract-form-next"
                >
                  {t(locale, "common.next")}
                </Button>
              )}
            </div>
          </div>
      </ContentPaper>

      {/* eformsign Document Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={(open: boolean) => !open && handleDialogClose()}>
        <DialogContent
          data-component="messages-contract-form-dialog"
          className="max-w-full w-screen h-screen p-0 gap-0"
        >
          <DialogHeader className="px-4 py-2 flex flex-row items-center justify-between border-b">
            <DialogTitle>계약서 작성</DialogTitle>
            <Button
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

      {/* Client creation dialog */}
      <ClientFormDialog
        open={isClientDialogOpen}
        onClose={() => setIsClientDialogOpen(false)}
        onSuccess={handleClientCreated}
      />
    </>
  );
};
