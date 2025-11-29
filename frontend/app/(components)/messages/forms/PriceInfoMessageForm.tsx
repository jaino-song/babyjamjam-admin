"use client";
import { useState, useEffect } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
  Fade,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import voucherOptions from "../templates/json/voucher.json";
import bankAccountJSON from "../templates/json/bank-account.json";
import { priceInfoMsgTemplate } from "../templates/messageTemplate/priceInfoMsg";
import { t } from "@/app/lib/i18n/translations";
import { useFormStore } from "@/app/store/form-store";
import { useLocale } from "@/app/(components)/LocaleProvider";
import { useBankAccountInfos, useVoucherPriceInfos } from "@/app/hooks";
import { NameInput } from "./form-components/NameInput";

interface PriceInfoFormData {
  name: string;
  weeks: number;
  duration: string;
  type: string;
  voucherId: number | null;
  fullPrice: string;
  grant: string;
  actualPrice: string;
  area: string;
  bankName: string;
  accNum: string;
}

interface VoucherPriceInfo {
  id: number;
  type: string | null;
  duration: string;
  fullPrice: string | null;
  grant: string | null;
  actualPrice: string | null;
}

interface BankAccountInfo {
  area: string;
  bankName: string;
  accNum: string;
}

export const PriceInfoMessageForm = () => {
  const locale = useLocale();
  const [generatedMessage, setGeneratedMessage] = useState("");

  // Subscribe to Zustand store
  const { name, voucherType, voucherDuration, setName, setVoucherType, setVoucherDuration, setFullPrice, setActualPrice, setGrant } = useFormStore();

  const [formData, setFormData] = useState<PriceInfoFormData>({
    name: name,
    weeks: 0,
    duration: voucherDuration,
    type: voucherType,
    voucherId: null,
    fullPrice: "",
    grant: "",
    actualPrice: "",
    area: "",
    bankName: "",
    accNum: "",
  });

  // Sync local state with Zustand store when store changes
  useEffect(() => {
    setFormData(prev => ({
      ...prev,
      name: name,
      duration: voucherDuration,
      type: voucherType,
    }));
  }, [name, voucherType, voucherDuration]);

  // Bank account info query
  const { data: bankAccountInfos = [], isLoading: isBankAccountInfosLoading, error: bankAccountInfosError } = useBankAccountInfos();

  // Voucher price info query
  const { data: voucherPriceInfos = [], isLoading: isVoucherPriceInfosLoading, error: voucherPriceInfosError } = useVoucherPriceInfos(formData.type);

  // Voucher type change handler
  const handleVoucherTypeChange = (value: string) => {
    console.log('Voucher type changed:', value);
    setFormData(prev => ({
      ...prev,
      type: value,
      weeks: 0,
      duration: "",
      voucherId: null,
    }));
    setVoucherType(value); // Update Zustand store
    setVoucherDuration(""); // Reset duration in store when type changes
  };

  const handleDurationChange = (duration: string) => {
    const selectedVoucher = voucherPriceInfos.find(v => v.duration === duration);
    console.log('Selected Duration:', duration);

    if (selectedVoucher) {
      setFormData(prev => ({
        ...prev,
        duration: duration,
        weeks: Math.floor(Number(selectedVoucher.duration) / 5),
        voucherId: selectedVoucher.id,
        fullPrice: selectedVoucher.fullPrice?.toString() ?? "",
        grant: selectedVoucher.grant?.toString() ?? "",
        actualPrice: selectedVoucher.actualPrice?.toString() ?? "",
      }));
      // Update Zustand store
      setVoucherDuration(duration);
      setFullPrice(selectedVoucher.fullPrice?.toString() ?? "");
      setGrant(selectedVoucher.grant?.toString() ?? "");
      setActualPrice(selectedVoucher.actualPrice?.toString() ?? "");
    }
  };

  const handleAreaChange = (value: string) => {
    setFormData(prev => ({
      ...prev,
      area: value ?? "",
      bankName: bankAccountInfos.find(b => b.area === value)?.bankName ?? "",
      accNum: bankAccountInfos.find(b => b.area === value)?.accNum ?? "",
    }));
  };

  const handleGenerate = () => {
    const message = priceInfoMsgTemplate(formData);
    setGeneratedMessage(message);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedMessage);
    alert(t(locale, "common.copy-success-message"));
  };

  return (
    <Paper elevation={2} data-component="price-info-message-form" sx={{ display: "flex", flexDirection: "column", justifyContent: "center", borderTopLeftRadius: 0, borderTopRightRadius: 0, p: 3, flexGrow: 1, width: "100%", height: "100%", bgcolor: "background.default" }}>
      <Fade in appear timeout={500}>
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
          {/* title */}
          <Typography variant="h5" color="primary.main" fontWeight={700} gutterBottom>
            {t(locale, "price-info-msg.title")}
          </Typography>
      {/* subtitle */}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t(locale, "price-info-msg.subtitle")}
      </Typography>

      {/* form */}
      <Card elevation={0} data-component="price-info-message-form-card" sx={{ bgcolor: "background.default" }}>
        <CardContent>
          <Stack spacing={3}>
            <NameInput name={name} setName={setName} label={t(locale, "price-info-msg.name-label")} placeholder={t(locale, "price-info-msg.name-placeholder")} />
            {/* voucher type */}
            <FormControl fullWidth>
              <InputLabel>{t(locale, "price-info-msg.voucher-type-label")}</InputLabel>
              <Select
                value={formData.type}
                label={isVoucherPriceInfosLoading ? t(locale, "common.loading") : t(locale, "price-info-msg.voucher-type-label")}
                onChange={(e) => handleVoucherTypeChange(e.target.value)}
                disabled={isVoucherPriceInfosLoading}
              >
                {Object.entries(voucherOptions.voucherOptions).map(([groupName, types]) => [
                  <MenuItem key={groupName} disabled sx={{ fontWeight: 600 }}>
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

            {/* voucher duration */}
            {formData.type && voucherPriceInfos.length > 0 && (
              <FormControl fullWidth>
                <InputLabel>{t(locale, "price-info-msg.duration-label")}</InputLabel>
                <Select
                  value={formData.duration === "" ? "" : formData.duration}
                  label={t(locale, "price-info-msg.duration-label")}
                  onChange={(e) => handleDurationChange(e.target.value)}
                >
                  {voucherPriceInfos.map((v) => (
                    <MenuItem key={v.duration} value={v.duration}>
                      {v.duration}일
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            {/* area */}
            <FormControl fullWidth>
              <InputLabel>{t(locale, "price-info-msg.area-label")}</InputLabel>
              <Select
                value={formData.area}
                label={t(locale, "price-info-msg.area-label")}
                onChange={(e) => handleAreaChange(e.target.value)}
              >
                {Object.values(bankAccountInfos).map((bankAccountInfo: BankAccountInfo) => (
                  <MenuItem key={bankAccountInfo.area} value={bankAccountInfo.area}>
                    {bankAccountJSON[bankAccountInfo.area as keyof typeof bankAccountJSON].area}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Price Info */}
            {formData.fullPrice && formData.grant && formData.actualPrice && (
              <Stack spacing={2}>
                <Typography variant="body1" fontWeight={500}>{t(locale, "price-info-msg.full-price-label")}: {formData.fullPrice}{t(locale, "common.currency-symbol")}</Typography>
                <Typography variant="body1" fontWeight={500}>{t(locale, "price-info-msg.grant-price-label")}: {formData.grant}{t(locale, "common.currency-symbol")}</Typography>
                <Typography variant="body1" fontWeight={500}>{t(locale, "price-info-msg.actual-price-label")}: {formData.actualPrice}{t(locale, "common.currency-symbol")}</Typography>
              </Stack>
            )}

            {/* generate button */}
            <Button
              variant="contained"
              size="large"
              onClick={handleGenerate}
              disabled={!formData.name || !formData.type || !formData.area || isVoucherPriceInfosLoading || isBankAccountInfosLoading}
              data-component="price-info-message-form-generate-button"
            >
              {isVoucherPriceInfosLoading || isBankAccountInfosLoading ? t(locale, "common.generate-button-loading") : t(locale, "common.generate-button")}
            </Button>
          </Stack>
        </CardContent>
      </Card>

          {/* generated message */}
          {generatedMessage && (
            <Paper elevation={0} data-component="price-info-message-form-generated-message" sx={{ p: 0 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                <Typography variant="h6" color="primary.main" fontWeight={600}>
                  {t(locale, "common.generated-message-title")}
                </Typography>
                <Button
                  variant="outlined"
                  size="medium"
                  startIcon={<ContentCopyIcon />}
                  onClick={handleCopy}
                >
                  {t(locale, "common.copy-button")}
                </Button>
              </Stack>
              <Paper data-component="price-info-message-form-generated-message-paper" sx={{ p: 2, border: 2, borderColor: "grey.200", maxHeight: "50vh", overflow: "auto" }}>
                <Typography
                  variant="body2"
                  component="pre"
                  sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: "1rem" }}
                >
                  {generatedMessage}
                </Typography>
              </Paper>
            </Paper>
          )}
        </Box>
      </Fade>
    </Paper>
  );
};

