"use client";
import {
  Button,
  Card,
  CardContent,
  Paper,
  Stack,
  TextField,
  Typography,
  Stepper,
  Step,
  StepLabel,
  InputAdornment,
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
} from "@mui/material";
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
import { useState } from "react";
import { useEformsign } from "@/app/lib/eformsign/useEformsign";
import type { EformsignDocumentOption } from "@/app/lib/eformsign/types";
import { useVoucherPriceInfos } from "@/app/hooks";
import voucherOptions from "../templates/json/voucher.json";
import { MoonLoader } from "react-spinners";
import { NameInput } from "./form-components/NameInput";
import { ContactInput } from "./form-components/ContactInput";

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

export const ContractCreationForm = () => {
  const locale = useLocale();
  const [activeStep, setActiveStep] = useState(0);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [documentCreated, setDocumentCreated] = useState(false);

  const { isLoaded: isEformsignLoaded, isLoading: isEformsignLoading, error: eformsignError, openDocument } = useEformsign();

  const {
    name,
    phone,
    startDate,
    endDate,
    employeeName,
    employeePhone,
    paymentDate,
    fullPrice,
    grant,
    actualPrice,
    voucherType,
    voucherDuration,
    setName,
    setPhone,
    setStartDate,
    setEndDate,
    setEmployeeName,
    setEmployeePhone,
    setPaymentDate,
    setFullPrice,
    setGrant,
    setActualPrice,
    setVoucherType,
    setVoucherDuration,
  } = useFormStore();

  // Voucher price info query - fetches price data based on selected voucher type
  const { data: voucherPriceInfos = [], isLoading: isVoucherPriceInfosLoading } = useVoucherPriceInfos(voucherType);

  // Cast the result of t() to string[] because the translation returns an array for this key
  const steps = t(locale, "contract-msg.pagination-steps") as unknown as string[];

  const handleStepBack = () => {
    setActiveStep((prevActiveStep) => prevActiveStep - 1);
  };

  const handleStepNext = () => {
    setActiveStep((prevActiveStep) => prevActiveStep + 1);
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

  const handleContractCreation = async () => {
    if (!isEformsignLoaded) {
      setSubmitError("eformsign SDK가 아직 로드되지 않았습니다. 잠시 후 다시 시도해주세요.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
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
        customerDOB: "", // Missing in form
        customerAddress: "", // Missing in form
        caretaker1Name: employeeName,
        caretaker1Contact: employeePhone,
        type: "", // Missing in form
        days: "", // Missing in form
        area: "", // Missing in form
        contractDuration: end.diff(start, 'day').toString(),
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
      const documentOption: EformsignDocumentOption = await eformsignApi.generateDocument(
        contractData
      );

      console.log("Document option generated:", documentOption);

      // Open the dialog first
      setIsDialogOpen(true);

      // Wait a tick for the dialog/iframe to render
      setTimeout(() => {
        openDocument(documentOption, "eformsign_iframe", {
          onSuccess: (response) => {
            console.log("Document created successfully:", response);
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
  const isStep1Valid = name && phone;
  const isStep2Valid = employeeName && employeePhone;
  const isStep3Valid = startDate && endDate && paymentDate;

  const isNextDisabled = () => {
    if (activeStep === 0) return !isStep1Valid;
    if (activeStep === 1) return !isStep2Valid;
    return false;
  };

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="ko">

      <Paper
        elevation={2}
        data-component="contract-creation-form"
        sx={{
          display: "flex",
          flexDirection: "column",
          borderTopLeftRadius: 0,
          borderTopRightRadius: 0,
          p: 3,
          flexGrow: 1,
          width: "100%",
          height: "100%",
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
                  <StepLabel>{label}</StepLabel>
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
                      {/* 이용자 성명 */}
                      <NameInput name={name} setName={setName} label={t(locale, "contract-msg.name-label")} placeholder={t(locale, "contract-msg.name-placeholder")} />
                      {/* 이용자 연락처 */}
                      <ContactInput phone={phone} setPhone={setPhone} label={t(locale, "contract-msg.phone-label")} placeholder={t(locale, "contract-msg.phone-placeholder")} />
                    </Stack>
                  </Fade>
                )}

                {/* Step 1: Provider Info */}
                {activeStep === 1 && (
                  <Fade in appear timeout={300}>
                    <Stack spacing={3}>
                      {/* 제공인력 1 */}
                      <NameInput name={employeeName} setName={setEmployeeName} label={t(locale, "contract-msg.employee-name-label")} placeholder={t(locale, "contract-msg.employee-name-placeholder")} />
                      {/* 제공인력 1 연락처 */}
                      <ContactInput phone={employeePhone} setPhone={setEmployeePhone} label={t(locale, "contract-msg.employee-phone-label")} placeholder={t(locale, "contract-msg.employee-phone-placeholder")} />
                    </Stack>
                  </Fade>
                )}

                {/* Step 2: Contract Info */}
                {activeStep === 2 && (
                  <Fade in appear timeout={300}>
                    <Stack spacing={3}>
                      {(!fullPrice || !grant || !actualPrice) ? (
                        <>
                          {/* 바우처 유형 선택 */}
                          <FormControl fullWidth sx={{ bgcolor: "background.default" }}>
                            <InputLabel>{t(locale, "price-info-msg.voucher-type-label")}</InputLabel>
                            <Select
                              value={voucherType}
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
                        </>
                      ) : (
                        <>
                          {/* 서비스 금액 */}
                          <Fade in timeout={400}>
                            <TextField
                              fullWidth
                              label={t(locale, "contract-msg.full-price-label")}
                              value={fullPrice}
                              onChange={(e) => setFullPrice(e.target.value)}
                              placeholder={t(locale, "contract-msg.price-placeholder")}
                              slotProps={{
                                input: {
                                  endAdornment: <InputAdornment position="end">원</InputAdornment>,
                                },
                              }}
                            />
                          </Fade>
                          {/* 정부지원금 */}
                          <Fade in timeout={400} style={{ transitionDelay: "100ms" }}>
                            <TextField
                              fullWidth
                              label={t(locale, "contract-msg.grant-label")}
                              value={grant}
                              onChange={(e) => setGrant(e.target.value)}
                              placeholder={t(locale, "contract-msg.price-placeholder")}
                              slotProps={{
                                input: {
                                  endAdornment: <InputAdornment position="end">원</InputAdornment>,
                                },
                              }}
                            />
                          </Fade>
                          {/* 본인부담금 */}
                          <Fade in timeout={400} style={{ transitionDelay: "200ms" }}>
                            <TextField
                              fullWidth
                              label={t(locale, "contract-msg.actual-price-label")}
                              value={actualPrice}
                              onChange={(e) => setActualPrice(e.target.value)}
                              placeholder={t(locale, "contract-msg.price-placeholder")}
                              slotProps={{
                                input: {
                                  endAdornment: <InputAdornment position="end">원</InputAdornment>,
                                },
                              }}
                            />
                          </Fade>
                          {/* 계약 시작일 */}
                          <Fade in timeout={400} style={{ transitionDelay: "300ms" }}>
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
                          <Fade in timeout={400} style={{ transitionDelay: "400ms" }}>
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
                          <Fade in timeout={400} style={{ transitionDelay: "500ms" }}>
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
                        </>
                      )}
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
                  disabled={!isStep3Valid || isSubmitting || !isEformsignLoaded}
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
      </Paper>

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
        <DialogContent sx={{ p: 0, overflow: "hidden" }}>
          <iframe
            id="eformsign_iframe"
            style={{
              width: "100%",
              height: "100%",
              border: "none",
            }}
            title="eformsign Document"
          />
        </DialogContent>
      </Dialog>
    </LocalizationProvider>
  );
};

