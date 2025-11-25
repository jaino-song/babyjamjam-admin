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
} from "@mui/material";
import { t } from "@/app/lib/i18n/translations";
import { useFormStore } from "@/app/store/form-store";
import { eformsignApi } from "@/services/api";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import dayjs, { Dayjs } from "dayjs";
import "dayjs/locale/ko";
import { useState } from "react";

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

// Set Korean as the global locale
dayjs.locale("ko");

export const ContractCreationForm = () => {
  const [activeStep, setActiveStep] = useState(0);
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
  } = useFormStore();

  // Cast the result of t() to string[] because the translation returns an array for this key
  const steps = t("ko", "contract-msg.pagination-steps") as unknown as string[];

  const handleStepBack = () => {
    setActiveStep((prevActiveStep) => prevActiveStep - 1);
  };

  const handleStepNext = () => {
    setActiveStep((prevActiveStep) => prevActiveStep + 1);
  };

  const handleContractCreation = async () => {
    try {
      const executionTime = Date.now();
      const { oauth_token } = await eformsignApi.getAccessToken(executionTime);

      if (!oauth_token) {
        throw new Error("Failed to get access token");
      }

      const { access_token, refresh_token } = oauth_token;

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
        startYear: start.format("YYYY"),
        startMonth: start.format("MM"),
        startDay: start.format("DD"),
        startDate: startDate,
        endYear: end.format("YYYY"),
        endMonth: end.format("MM"),
        endDay: end.format("DD"),
        endDate: endDate,
        paymentYear: payment.format("YYYY"),
        paymentMonth: payment.format("MM"),
        paymentDay: payment.format("DD"),
        receiptYear: today.format("YYYY"),
        receiptMonth: today.format("MM"),
        receiptDay: today.format("DD"),
        fullPrice: fullPrice,
        grant: grant,
        actualPrice: actualPrice,
      };

      const response = await eformsignApi.generateDocument(
        contractData,
        access_token,
        refresh_token
      );

      console.log("Document generated:", response);
    } catch (error) {
      console.error("Error creating contract:", error);
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
        sx={{
          display: "flex",
          flexDirection: "column",
          borderTopLeftRadius: 0,
          borderTopRightRadius: 0,
          p: 3,
          flexGrow: 1,
          width: "100%",
          height: "100%",
        }}
      >
        {/* title */}
        <Typography
          variant="h5"
          color="primary.main"
          fontWeight={700}
          gutterBottom
        >
          {t("ko", "msg-type.contract")}
        </Typography>
        {/* subtitle */}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t("ko", "contract-msg.subtitle")}
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
        <Card elevation={0} sx={{ flexGrow: 1, overflow: "auto" }}>
          <CardContent>
            <Stack spacing={3}>
              {/* Step 0: User Info */}
              {activeStep === 0 && (
                <>
                  <TextField
                    fullWidth
                    label={t("ko", "contract-msg.name-label")}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("ko", "contract-msg.name-placeholder")}
                  />
                  <TextField
                    fullWidth
                    label={t("ko", "contract-msg.phone-label")}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder={t("ko", "contract-msg.phone-placeholder")}
                  />
                </>
              )}

              {/* Step 1: Provider Info */}
              {activeStep === 1 && (
                <>
                  <TextField
                    fullWidth
                    label={t("ko", "contract-msg.employee-name-label")}
                    value={employeeName}
                    onChange={(e) => setEmployeeName(e.target.value)}
                    placeholder={t("ko", "contract-msg.employee-name-placeholder")}
                  />
                  <TextField
                    fullWidth
                    label={t("ko", "contract-msg.employee-phone-label")}
                    value={employeePhone}
                    onChange={(e) => setEmployeePhone(e.target.value)}
                    placeholder={t("ko", "contract-msg.employee-phone-placeholder")}
                  />
                </>
              )}

              {/* Step 2: Contract Info */}
              {activeStep === 2 && (
                <>
                  <TextField
                    fullWidth
                    label={t("ko", "contract-msg.full-price-label")}
                    value={fullPrice}
                    onChange={(e) => setFullPrice(e.target.value)}
                    placeholder={t("ko", "contract-msg.price-placeholder")}
                    slotProps={{
                      input: {
                        endAdornment: <InputAdornment position="end">원</InputAdornment>,
                      },
                    }}
                  />
                  <TextField
                    fullWidth
                    label={t("ko", "contract-msg.grant-label")}
                    value={grant}
                    onChange={(e) => setGrant(e.target.value)}
                    placeholder={t("ko", "contract-msg.price-placeholder")}
                    slotProps={{
                      input: {
                        endAdornment: <InputAdornment position="end">원</InputAdornment>,
                      },
                    }}
                  />
                  <TextField
                    fullWidth
                    label={t("ko", "contract-msg.actual-price-label")}
                    value={actualPrice}
                    onChange={(e) => setActualPrice(e.target.value)}
                    placeholder={t("ko", "contract-msg.price-placeholder")}
                    slotProps={{
                      input: {
                        endAdornment: <InputAdornment position="end">원</InputAdornment>,
                      },
                    }}
                  />
                  <DatePicker
                    label={t("ko", "contract-msg.start-date-label")}
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
                        toolbarFormat: "YYYY년 MM월 DD일",
                      },
                      textField: {
                        fullWidth: true,
                        placeholder: "25년 01월 01일",
                      },
                    }}
                  />
                  <DatePicker
                    label={t("ko", "contract-msg.end-date-label")}
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
                        toolbarFormat: "YYYY년 MM월 DD일",
                      },
                      textField: {
                        fullWidth: true,
                        placeholder: "25년 12월 31일",
                      },
                    }}
                  />
                  <DatePicker
                    label={t("ko", "contract-msg.payment-date-label")}
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
                        toolbarFormat: "YYYY년 MM월 DD일",
                      },
                      textField: {
                        fullWidth: true,
                        placeholder: "25년 01월 01일",
                      },
                    }}
                  />
                </>
              )}
            </Stack>
          </CardContent>
        </Card>

        {/* Navigation Buttons */}
        <Stack direction="row" spacing={2} sx={{ mt: 3, justifyContent: "space-between" }}>
          <Button
            variant="outlined"
            onClick={handleStepBack}
            disabled={activeStep === 0}
          >
            {t("ko", "common.back")}
          </Button>

          {activeStep === steps.length - 1 ? (
            <Button
              variant="contained"
              onClick={handleContractCreation}
              disabled={!isStep3Valid}
            >
              {t("ko", "contract-msg.contract-creation")}
            </Button>
          ) : (
            <Button
              variant="contained"
              onClick={handleStepNext}
              disabled={isNextDisabled()}
            >
              {t("ko", "common.next")}
            </Button>
          )}
        </Stack>
      </Paper>
    </LocalizationProvider>
  );
};

