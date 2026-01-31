"use client";
import {
  Button,
  Card,
  CardContent,
  Stack,
  TextField,
  Typography,
  Stepper,
  Step,
  StepLabel,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  CircularProgress,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Fade,
  Box,
  FormControlLabel,
  Checkbox,
  Divider,
} from "@mui/material";
import { ContentPaper } from "@/app/(components)/root/content-paper";
import CloseIcon from "@mui/icons-material/Close";
import { t } from "@/app/lib/i18n/translations";
import { useFormStore } from "@/app/store/form-store";
import { useLocale } from "@/app/(components)/LocaleProvider";
import { eformsignApi } from "@/services/api";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import dayjs, { Dayjs } from "dayjs";
import "dayjs/locale/ko";
import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useEformsign } from "@/app/lib/eformsign/useEformsign";
import type { EformsignDocumentOption } from "@/app/lib/eformsign/types";
import { eformsignQueryKeys } from "@/app/hooks/useEformsignDocuments";
import { useVoucherPriceInfos, useVoucherYears, useAreaTemplates } from "@/app/hooks";
import voucherOptions from "../templates/json/voucher.json";
import { MoonLoader } from "react-spinners";
import { NameInput } from "./form-components/NameInput";
import { ContactInput } from "./form-components/ContactInput";
import { ClientAutocomplete } from "../../clients/ClientAutocomplete";
import { EmployeeAutocomplete } from "../../clients/EmployeeAutocomplete";
import { ClientFormDialog } from "../../clients/ClientFormDialog";
import { useCreateClient } from "@/app/hooks/useClients";
import { useEmployees } from "@/app/hooks/useEmployees";
import type { Client } from "@/app/lib/client/types";
import type { Employee } from "@/app/hooks/useEmployees";

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

// // Set Korean as the global locale
// dayjs.locale("ko");

// 가격 포맷팅 (천 단위 콤마)
function formatPrice(price: string): string {
  const num = parseInt(price.replace(/[,원\s]/g, ""), 10);
  if (isNaN(num)) return price;
  return num.toLocaleString("ko-KR");
}

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

  // Client creation mutation - used when creating new client via manual entry
  const createClientMutation = useCreateClient();

  // Employees query - used to look up employee details when client is selected
  const { data: employees } = useEmployees();

  // Ref to store selected client for delayed employee auto-population
  // Used when employees list loads after client selection
  const selectedClientRef = useRef<Client | null>(null);

  // Auto-populate employees when client has employee info AND employees list is loaded
  // This handles the race condition where client is selected before employees finish loading
  useEffect(() => {
    const client = selectedClientRef.current;

    // Skip if no client selected or employees not yet loaded
    if (!client || !employees) return;

    // Skip if user manually entered an employee (don't override manual selection)
    // Note: We use isEmployeeManualEntry instead of employeeId !== null because
    // when switching clients, we WANT to override the auto-selected employee from the previous client
    if (isEmployeeManualEntry) return;

    // Auto-populate primary employee if available AND different from current selection
    if (client.primaryEmployee) {
      const primaryEmp = employees.find(e => e.id === client.primaryEmployee?.id);
      if (primaryEmp && primaryEmp.id !== employeeId) {
        setEmployeeSelection(primaryEmp.id, primaryEmp.name, primaryEmp.phone);
        setIsEmployeeManualEntry(false);
      }
    }

    // Auto-populate secondary employee if available
    if (client.secondaryEmployee) {
      const secondaryEmp = employees.find(e => e.id === client.secondaryEmployee?.id);
      if (secondaryEmp && secondaryEmp.id !== employee2Id) {
        setShowEmployee2(true);
        setEmployee2Selection(secondaryEmp.id, secondaryEmp.name, secondaryEmp.phone);
        setIsEmployee2ManualEntry(false);
      }
    }
  }, [employees, employeeId, employee2Id, isEmployeeManualEntry, setEmployeeSelection, setIsEmployeeManualEntry, setShowEmployee2, setEmployee2Selection, setIsEmployee2ManualEntry]);

  // Voucher years query - fetches available years from database
  const { data: voucherYears = [], isLoading: isVoucherYearsLoading } = useVoucherYears();

  // Voucher price info query - fetches price data based on selected voucher type and year
  const { data: voucherPriceInfos = [], isLoading: isVoucherPriceInfosLoading } = useVoucherPriceInfos(voucherType, voucherYear);

  // Area templates query - fetches area-to-template mappings
  const { data: areaTemplates = [], isLoading: isAreaTemplatesLoading } = useAreaTemplates();

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
    <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="ko">

      <ContentPaper
        data-component="contract-creation-form"
        sx={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-start",
          flexGrow: 1,
          width: "100%",
          bgcolor: "background.default",
        }}
      >
        <Fade in appear timeout={500}>
          <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
            {/* title */}
            <Typography
              variant="h5"
              color="primary.main"
              fontWeight={700}
              gutterBottom
            >
              {t(locale, "msg-type.contract")}
            </Typography>
            {/* subtitle */}
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              {t(locale, "contract-msg.subtitle")}
            </Typography>

            {/* Stepper */}
            <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 4 }}>
              {steps.map((label) => (
                <Step key={label}>
                  <StepLabel sx={{ whiteSpace: "pre-line" }}>{label}</StepLabel>
                </Step>
              ))}
            </Stepper>

            {/* form */}
            <Card elevation={0} data-component="contract-creation-form-card" sx={{ flexGrow: 1, overflow: "auto" }}>
              <CardContent sx={{ bgcolor: "background.default" }}>
                {/* Step 0: User Info */}
                {activeStep === 0 && (
                  <Fade in appear timeout={300}>
                    <Stack spacing={3}>
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
                            <Fade in timeout={300}>
                              <Stack spacing={2} sx={{ pl: 1, borderLeft: 3, borderColor: "primary.main" }}>
                                <Typography variant="body2" color="text.secondary">
                                  <strong>{t(locale, "contract-msg.phone-label")}:</strong> {phone || "-"}
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                  <strong>{t(locale, "contract-msg.birthday-label")}:</strong> {birthday || "-"}
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                  <strong>{t(locale, "contract-msg.address-label")}:</strong> {address || "-"}
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                  <strong>{t(locale, "clients.form.due-date")}:</strong> {dueDate || "-"}
                                </Typography>
                              </Stack>
                            </Fade>
                          )}
                        </>
                      ) : (
                        <>
                          {/* Manual entry mode */}
                          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <Typography variant="subtitle2" color="text.secondary">
                              {t(locale, "contract-msg.manual-entry-mode")}
                            </Typography>
                            <Button
                              size="small"
                              variant="text"
                              onClick={handleToggleManualEntry}
                            >
                              {t(locale, "contract-msg.switch-to-search")}
                            </Button>
                          </Box>
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
                          <TextField
                            fullWidth
                            label={t(locale, "contract-msg.birthday-label")}
                            value={birthday}
                            onChange={(e) => setBirthday(e.target.value)}
                            placeholder="YYMMDD"
                          />
                          <TextField
                            fullWidth
                            label={t(locale, "contract-msg.address-label")}
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            placeholder={t(locale, "contract-msg.address-placeholder")}
                          />
                          <TextField
                            fullWidth
                            type="date"
                            label={t(locale, "clients.form.due-date")}
                            value={dueDate}
                            onChange={(e) => setDueDate(e.target.value)}
                            InputLabelProps={{ shrink: true }}
                          />
                        </>
                      )}
                      {/* 지역 선택 (계약서 템플릿) */}
                      <FormControl fullWidth required sx={{ bgcolor: "background.default" }}>
                        <InputLabel>{t(locale, "contract-msg.doc-type-label")}</InputLabel>
                        <Select
                          value={area}
                          required
                          label={t(locale, "contract-msg.doc-type-label")}
                          onChange={(e) => setArea(e.target.value)}
                          disabled={isAreaTemplatesLoading}
                          sx={{ bgcolor: "background.default" }}
                        >
                          {areaTemplates.map((template) => (
                            <MenuItem key={template.areaId} value={template.areaId}>
                              {template.templateName || template.areaId}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Stack>
                  </Fade>
                )}

                {/* Step 1: Provider Info */}
                {activeStep === 1 && (
                  <Fade in appear timeout={300}>
                    <Stack spacing={3}>
                      {/* Employee 1 Section */}
                      {!isEmployeeManualEntry ? (
                        <>
                          {/* Employee 1 selection mode */}
                          <EmployeeAutocomplete
                            value={employeeId}
                            onChange={handleEmployeeSelect}
                            label={t(locale, "contract-msg.employee-select-label")}
                            required
                            allowManualEntry
                            onManualEntry={handleToggleEmployeeManualEntry}
                            excludeIds={employee2Id !== null ? [employee2Id] : []}
                          />
                          {/* Show selected employee 1 info (read-only) */}
                          {employeeId !== null && (
                            <Fade in timeout={300}>
                              <Stack spacing={2} sx={{ pl: 1, borderLeft: 3, borderColor: "primary.main" }}>
                                <Typography variant="body2" color="text.secondary">
                                  <strong>{t(locale, "contract-msg.employee-phone-label")}:</strong> {employeePhone || "-"}
                                </Typography>
                              </Stack>
                            </Fade>
                          )}
                        </>
                      ) : (
                        <>
                          {/* Employee 1 manual entry mode */}
                          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <Typography variant="subtitle2" color="text.secondary">
                              {t(locale, "contract-msg.employee-manual-entry-mode")}
                            </Typography>
                            <Button
                              size="small"
                              variant="text"
                              onClick={handleToggleEmployeeManualEntry}
                            >
                              {t(locale, "contract-msg.switch-to-employee-search")}
                            </Button>
                          </Box>
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

                      {/* Employee 2 Toggle */}
                      <Divider sx={{ my: 1 }} />
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={showEmployee2}
                            onChange={handleToggleShowEmployee2}
                            color="primary"
                            sx={{ pl: 0 }}
                          />
                        }
                        label={t(locale, "contract-msg.add-employee2-toggle")}
                      />

                      {/* Employee 2 Section */}
                      {showEmployee2 && (
                        <Fade in timeout={300}>
                          <Stack spacing={3}>
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
                                  <Fade in timeout={300}>
                                    <Stack spacing={2} sx={{ pl: 1, borderLeft: 3, borderColor: "secondary.main" }}>
                                      <Typography variant="body2" color="text.secondary">
                                        <strong>{t(locale, "contract-msg.employee2-phone-label")}:</strong> {employee2Phone || "-"}
                                      </Typography>
                                    </Stack>
                                  </Fade>
                                )}
                              </>
                            ) : (
                              <>
                                {/* Employee 2 manual entry mode */}
                                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                  <Typography variant="subtitle2" color="text.secondary">
                                    {t(locale, "contract-msg.employee2-manual-entry-mode")}
                                  </Typography>
                                  <Button
                                    size="small"
                                    variant="text"
                                    onClick={handleToggleEmployee2ManualEntry}
                                  >
                                    {t(locale, "contract-msg.switch-to-employee2-search")}
                                  </Button>
                                </Box>
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
                          </Stack>
                        </Fade>
                      )}
                    </Stack>
                  </Fade>
                )}

                {/* Step 2: Voucher Info (바우처 정보) */}
                {activeStep === 2 && (
                  <Fade in appear timeout={300}>
                    <Stack spacing={3}>
                      {/* 바우처 연도 선택 */}
                      <FormControl fullWidth size="small" sx={{ bgcolor: "background.default", maxWidth: 120 }}>
                        <InputLabel>{t(locale, "price-info-msg.voucher-year-label")}</InputLabel>
                        <Select
                          value={voucherYear}
                          label={t(locale, "price-info-msg.voucher-year-label")}
                          onChange={(e) => handleVoucherYearChange(Number(e.target.value))}
                          disabled={isVoucherYearsLoading}
                          sx={{ bgcolor: "background.default" }}
                        >
                          {voucherYears.map((year) => (
                            <MenuItem key={year} value={year}>
                              {year}년
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>

                      {/* 바우처 유형 선택 */}
                      <FormControl fullWidth sx={{ bgcolor: "background.default" }}>
                        <InputLabel>{t(locale, "price-info-msg.voucher-type-label")}</InputLabel>
                        <Select
                          value={voucherType}
                          required
                          label={t(locale, "price-info-msg.voucher-type-label")}
                          onChange={(e) => handleVoucherTypeChange(e.target.value)}
                          sx={{ bgcolor: "background.default" }}
                        >
                          {Object.entries(voucherOptions.voucherOptions).map(([groupName, types]) => [
                            <MenuItem key={groupName} disabled sx={{ fontWeight: 600, bgcolor: "background.default" }}>
                              {groupName}
                            </MenuItem>,
                            ...Object.entries(types).map(([typeValue, typeData]) => (
                              <MenuItem key={typeValue} value={typeValue} sx={{ pl: 4 }}>
                                {typeData.label}
                              </MenuItem>
                            ))
                          ])}
                        </Select>
                      </FormControl>

                      {/* 바우처 기간 선택 - 유형 선택 후에만 표시 */}
                      {voucherType && voucherPriceInfos.length > 0 && (
                        <Fade in timeout={400}>
                          <FormControl fullWidth sx={{ bgcolor: "background.default" }}>
                            <InputLabel>{t(locale, "price-info-msg.duration-label")}</InputLabel>
                            <Select
                              value={voucherDuration}
                              label={t(locale, "price-info-msg.duration-label")}
                              onChange={(e) => handleDurationChange(e.target.value)}
                              disabled={isVoucherPriceInfosLoading}
                              sx={{ bgcolor: "background.default" }}
                            >
                              {voucherPriceInfos.map((v) => (
                                <MenuItem key={v.duration} value={v.duration} sx={{ bgcolor: "background.default" }}>
                                  {v.duration}일
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </Fade>
                      )}

                      {/* 로딩 표시 */}
                      {voucherType && isVoucherPriceInfosLoading && (
                        <Fade in timeout={300}>
                          <Box sx={{ display: "flex", justifyContent: "center" }}>
                            <MoonLoader
                              color="#1e88e5"
                              size={20}
                            />
                          </Box>
                        </Fade>
                      )}

                      {/* 가격 정보 - 기간 선택 후 표시 */}
                      {voucherDuration && fullPrice && grant && actualPrice && (
                        <Fade in timeout={400}>
                          <Stack spacing={1}>
                            <Divider sx={{ my: 1 }} />
                            <Typography variant="body1" fontWeight={500}>
                              {t(locale, "contract-msg.full-price-label")}: {formatPrice(fullPrice)}원
                            </Typography>
                            <Typography variant="body1" fontWeight={500}>
                              {t(locale, "contract-msg.grant-label")}: {formatPrice(grant)}원
                            </Typography>
                            <Typography variant="body1" fontWeight={500}>
                              {t(locale, "contract-msg.actual-price-label")}: {formatPrice(actualPrice)}원
                            </Typography>
                          </Stack>
                        </Fade>
                      )}
                    </Stack>
                  </Fade>
                )}

                {/* Step 3: Contract Info (계약 정보) */}
                {activeStep === 3 && (
                  <Fade in appear timeout={300}>
                    <Stack spacing={3}>
                      {/* 계약 시작일 */}
                      <Fade in timeout={400}>
                        <Box>
                          <DatePicker
                            label={t(locale, "contract-msg.start-date-label")}
                            value={startDate ? dayjs(startDate) : null}
                            onChange={(newValue: Dayjs | null) => {
                              setStartDate(newValue ? newValue.format("YYYY-MM-DD") : "");
                            }}
                            format="YY년 MM월 DD일"
                            localeText={{
                              clearButtonLabel: "초기화",
                              cancelButtonLabel: "취소",
                              okButtonLabel: "확인",
                              toolbarTitle: "날짜 선택",
                            }}
                            slotProps={{
                              toolbar: {
                                toolbarFormat: "YY년 MM월 DD일",
                              },
                              textField: {
                                fullWidth: true,
                                placeholder: "25년 01월 01일",
                              },
                            }}
                          />
                        </Box>
                      </Fade>
                      {/* 계약 종료일 */}
                      <Fade in timeout={400} style={{ transitionDelay: "100ms" }}>
                        <Box>
                          <DatePicker
                            label={t(locale, "contract-msg.end-date-label")}
                            value={endDate ? dayjs(endDate) : null}
                            onChange={(newValue: Dayjs | null) => {
                              setEndDate(newValue ? newValue.format("YYYY-MM-DD") : "");
                            }}
                            format="YY년 MM월 DD일"
                            localeText={{
                              clearButtonLabel: "초기화",
                              cancelButtonLabel: "취소",
                              okButtonLabel: "확인",
                              toolbarTitle: "날짜 선택",
                            }}
                            slotProps={{
                              toolbar: {
                                toolbarFormat: "YY년 MM월 DD일",
                              },
                              textField: {
                                fullWidth: true,
                                placeholder: "25년 12월 31일",
                              },
                            }}
                          />
                        </Box>
                      </Fade>
                      {/* 본인부담금 결제일 */}
                      <Fade in timeout={400} style={{ transitionDelay: "200ms" }}>
                        <Box>
                          <DatePicker
                            label={t(locale, "contract-msg.payment-date-label")}
                            value={paymentDate ? dayjs(paymentDate) : null}
                            onChange={(newValue: Dayjs | null) => {
                              setPaymentDate(
                                newValue ? newValue.format("YYYY-MM-DD") : ""
                              );
                            }}
                            format="YY년 MM월 DD일"
                            localeText={{
                              clearButtonLabel: "초기화",
                              cancelButtonLabel: "취소",
                              okButtonLabel: "확인",
                              toolbarTitle: "날짜 선택",
                            }}
                            slotProps={{
                              toolbar: {
                                toolbarFormat: "YY년 MM월 DD일",
                              },
                              textField: {
                                fullWidth: true,
                                placeholder: "25년 01월 01일",
                              },
                            }}
                          />
                        </Box>
                      </Fade>
                    </Stack>
                  </Fade>
                )}
              </CardContent>
            </Card>

            {/* Error Messages */}
            {(submitError || eformsignError) && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {submitError || eformsignError}
              </Alert>
            )}

            {/* Loading indicator for eformsign SDK */}
            {isEformsignLoading && (
              <Alert severity="info" sx={{ mt: 2 }}>
                eformsign SDK를 로드하는 중입니다...
              </Alert>
            )}

            {/* Navigation Buttons */}
            <Stack direction="row" spacing={2} sx={{ mt: 3, justifyContent: "space-between" }}>
              <Button
                variant="outlined"
                onClick={handleStepBack}
                disabled={activeStep === 0 || isSubmitting}
                data-component="contract-creation-form-back-button"
              >
                {t(locale, "common.back")}
              </Button>

              {activeStep === steps.length - 1 ? (
                <Button
                  variant="contained"
                  onClick={handleContractCreation}
                  disabled={!isStep4Valid || isSubmitting || !isEformsignLoaded}
                  startIcon={isSubmitting ? <CircularProgress size={20} color="inherit" /> : undefined}
                >
                  {isSubmitting ? "처리 중..." : t(locale, "contract-msg.contract-creation")}
                </Button>
              ) : (
                <Button
                  variant="contained"
                  onClick={handleStepNext}
                  disabled={isNextDisabled()}
                  data-component="contract-creation-form-next-button"
                >
                  {t(locale, "common.next")}
                </Button>
              )}
            </Stack>
          </Box>
        </Fade>
      </ContentPaper>

      {/* eformsign Document Dialog */}
      <Dialog
        open={isDialogOpen}
        onClose={handleDialogClose}
        data-component="contract-creation-form-dialog"
        fullScreen
      >
        <DialogTitle sx={{ px: 2, py: 1, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          계약서 작성
          <IconButton onClick={handleDialogClose} size="small">
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 0, overflow: "hidden", display: "flex", flexDirection: "column", flexGrow: 1, height: "calc(100vh - 64px)" }}>
          <div
            style={{
              width: "100%",
              height: "100%",
              overflow: "hidden",
            }}
          >
            <iframe
              id="eformsign_iframe"
              style={{
                width: "100%",
                height: "100%",
                border: "none",
                transform: "scale(1)",
                transformOrigin: "top left",
              }}
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
    </LocalizationProvider>
  );
};

