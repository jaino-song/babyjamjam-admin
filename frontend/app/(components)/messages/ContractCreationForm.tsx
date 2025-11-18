"use client";
import { useState } from "react";
import {
  Button,
  Card,
  CardContent,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { t } from "@/app/lib/i18n/translations";
import { useFormStore } from "@/app/store/form-store";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import dayjs, { Dayjs } from "dayjs";
import "dayjs/locale/ko";

// Set Korean as the global locale
dayjs.locale("ko");

export const ContractMessageForm = () => {
  const { name, phone, startDate, endDate, employeeName, employeePhone, fullPrice, grant, actualPrice, paymentDate, setName, setPhone, setStartDate, setEndDate, setEmployeeName, setEmployeePhone, setFullPrice, setGrant, setActualPrice, setPaymentDate } = useFormStore();

  const handleContractCreation = () => {
    console.log("contract creation");
  };

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="ko">
      <Paper elevation={2} sx={{ borderTopLeftRadius: 0, borderTopRightRadius: 0, p: 3 }}>
        {/* title */}
        <Typography variant="h5" color="primary.main" fontWeight={700} gutterBottom>
          {t("ko", "msg-type.contract")}
        </Typography>
        {/* subtitle */}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t("ko", "contract-msg.subtitle")}
        </Typography>

        {/* form */}
        <Card elevation={0}>
          <CardContent>
            <Stack spacing={3}>
            {/* name */}
            <TextField
              fullWidth
              label={t("ko", "contract-msg.name-label")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("ko", "contract-msg.name-placeholder")}
            />
            {/* phone */}
            <TextField
              fullWidth
              label={t("ko", "contract-msg.phone-label")}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t("ko", "contract-msg.phone-placeholder")}
            />
            {/* Contract Start Date */}
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
            {/* Contract End Date */}
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
            {/* Employee Name */}
            <TextField
              fullWidth
              label={t("ko", "contract-msg.employee-name-label")}
              value={employeeName}
              onChange={(e) => setEmployeeName(e.target.value)}
              placeholder={t("ko", "contract-msg.employee-name-placeholder")}
            />
            {/* Employee Phone */}
            <TextField
              fullWidth
              label={t("ko", "contract-msg.employee-phone-label")}
              value={employeePhone}
              onChange={(e) => setEmployeePhone(e.target.value)}
              placeholder={t("ko", "contract-msg.employee-phone-placeholder")}
            />
            {/* Payment Date */}
            <DatePicker
              label={t("ko", "contract-msg.payment-date-label")}
              value={paymentDate ? dayjs(paymentDate) : null}
              onChange={(newValue: Dayjs | null) => {
                setPaymentDate(newValue ? newValue.format("YYYY-MM-DD") : "");
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

            {/* generate button */}
            <Button
              variant="contained"
              size="large"
              onClick={handleContractCreation}
              disabled={!name || !phone || !startDate || !endDate || !employeeName || !employeePhone || !paymentDate}
            >
              {t("ko", "contract-msg.contract-creation")}
            </Button>
          </Stack>
        </CardContent>
      </Card>
      </Paper>
    </LocalizationProvider>
  );
};

