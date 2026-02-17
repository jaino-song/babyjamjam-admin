"use client";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import voucherOptions from "../templates/json/voucher.json";
import { GeneratedMsg } from "../templates/GeneratedMsg";
import bankAccountJSON from "../templates/json/bank-account.json";
import { priceInfoMsgTemplate } from "../templates/messageTemplate/priceInfoMsg";
import { t } from "@/lib/i18n/translations";
import { useFormStore } from "@/stores/form-store";
import { useLocale } from "@/providers/LocaleProvider";
import { useBankAccountInfos, useVoucherPriceInfos } from "@/hooks";
import { useSystemTemplate } from "@/features/system-templates/hooks";
import { renderTemplate } from "@/lib/template-utils";
import { NameInput } from "./form-components/NameInput";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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

interface BankAccountInfo {
  area: string;
  bankName: string;
  accNum: string;
}

// 가격 포맷팅 (천 단위 콤마)
function formatPrice(price: string): string {
  const num = parseInt(price.replace(/[,원\s]/g, ""), 10);
  if (isNaN(num)) return price;
  return num.toLocaleString("ko-KR");
}

export const PriceInfoMessageForm = () => {
  const locale = useLocale();
  const [generatedMessage, setGeneratedMessage] = useState("");
  const [durationTooltipOpen, setDurationTooltipOpen] = useState<boolean>(false);
  const tooltipTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    };
  }, []);
  const { data: systemTemplate } = useSystemTemplate("PRICE_INFO");
 
  // Subscribe to Zustand store
  const { name, voucherType, voucherDuration, voucherYear, setName, setVoucherType, setVoucherDuration, setFullPrice, setActualPrice, setGrant, setVoucherYear } = useFormStore();

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
  const { data: bankAccountInfos = [], isLoading: isBankAccountInfosLoading } = useBankAccountInfos();

  // Voucher price info query (연도 필터 적용)
  const { data: voucherPriceInfos = [], isLoading: isVoucherPriceInfosLoading } = useVoucherPriceInfos(formData.type, voucherYear);

  // Voucher type change handler
  const handleVoucherTypeChange = (value: string) => {
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

  const handleDurationTooltipOpen = (open: boolean) => {
    if (!formData.type && open) {
      setDurationTooltipOpen(true);
      if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = setTimeout(() => setDurationTooltipOpen(false), 3000);
    } else {
      setDurationTooltipOpen(false);
    }
  };

  const handleGenerate = () => {
    const formattedData = {
      ...formData,
      fullPrice: formatPrice(formData.fullPrice),
      grant: formatPrice(formData.grant),
      actualPrice: formatPrice(formData.actualPrice),
    };

    const message = systemTemplate?.content
      ? renderTemplate(systemTemplate.content, {
          name: formattedData.name,
          weeks: formattedData.weeks,
          duration: formattedData.duration,
          type: formattedData.type,
          fullPrice: formattedData.fullPrice,
          grant: formattedData.grant,
          actualPrice: formattedData.actualPrice,
          bankName: formattedData.bankName,
          accNum: formattedData.accNum,
        })
      : priceInfoMsgTemplate(formattedData);

    setGeneratedMessage(message);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedMessage);
    alert(t(locale, "common.copy-success-message"));
  };

  return (
    <div
      data-component="messages-price-info-form"
      className="flex flex-col gap-4 animate-fade-in"
    >
          <div className="grid grid-cols-16 gap-4">
            <div className="col-span-10">
              <NameInput
                name={name}
                setName={setName}
                label={t(locale, "price-info-msg.name-label")}
                placeholder={t(locale, "price-info-msg.name-placeholder")}
              />
            </div>
            <div className="space-y-2 col-span-6">
              <Label>{t(locale, "price-info-msg.voucher-year-label")}</Label>
              <Select
                value={String(voucherYear)}
                onValueChange={(value: string) => {
                  setVoucherYear(Number(value));
                  setFormData((prev) => ({ ...prev, duration: "", voucherId: null }));
                  setVoucherDuration("");
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t(locale, "price-info-msg.voucher-year-label")} />
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

            <div className="space-y-2 col-span-5">
              <Label>{t(locale, "price-info-msg.duration-label")}</Label>
              <TooltipProvider delayDuration={0}>
                <Tooltip open={durationTooltipOpen} onOpenChange={handleDurationTooltipOpen}>
                  <TooltipTrigger asChild>
                    <div tabIndex={!formData.type ? 0 : -1}>
                      <Select
                        value={formData.duration || undefined}
                        onValueChange={handleDurationChange}
                        disabled={!formData.type || voucherPriceInfos.length === 0}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t(locale, "price-info-msg.duration-label")} />
                        </SelectTrigger>
                        <SelectContent>
                          {voucherPriceInfos.map((v) => (
                            <SelectItem key={v.id} value={v.duration}>
                              {v.duration}일
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>바우처 유형을 선택하세요</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            <div className="space-y-2 col-span-5">
              <Label>{t(locale, "price-info-msg.area-label")}</Label>
              <Select value={formData.area || undefined} onValueChange={handleAreaChange}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t(locale, "price-info-msg.area-label")} />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(bankAccountInfos).map((bankAccountInfo: BankAccountInfo) => (
                    <SelectItem key={bankAccountInfo.area} value={bankAccountInfo.area}>
                      {bankAccountJSON[bankAccountInfo.area as keyof typeof bankAccountJSON].area}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 col-span-6">
              <Label>
                {isVoucherPriceInfosLoading
                  ? t(locale, "common.loading")
                  : t(locale, "price-info-msg.voucher-type-label")}
              </Label>
              <Select
                value={formData.type}
                onValueChange={handleVoucherTypeChange}
                disabled={isVoucherPriceInfosLoading}
              >
                <SelectTrigger className="w-full">
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
          </div>

          {/* Price Info */}
          {formData.fullPrice && formData.grant && formData.actualPrice && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">
                {t(locale, "price-info-msg.full-price-label")}: {formatPrice(formData.fullPrice)}
                {t(locale, "common.currency-symbol")}
              </p>
              <p className="text-sm font-medium">
                {t(locale, "price-info-msg.grant-price-label")}: {formatPrice(formData.grant)}
                {t(locale, "common.currency-symbol")}
              </p>
              <p className="text-sm font-medium">
                {t(locale, "price-info-msg.actual-price-label")}: {formatPrice(formData.actualPrice)}
                {t(locale, "common.currency-symbol")}
              </p>
            </div>
          )}

          {/* generate button */}
          <Button
            size="lg"
            onClick={handleGenerate}
            disabled={
              !formData.name ||
              !formData.type ||
              !formData.area ||
              isVoucherPriceInfosLoading ||
              isBankAccountInfosLoading
            }
            data-component="messages-price-info-form-generate"
          >
            {isVoucherPriceInfosLoading || isBankAccountInfosLoading
              ? t(locale, "common.generate-button-loading")
              : t(locale, "common.generate-button")}
          </Button>

        {generatedMessage && (
          <GeneratedMsg
            title={t(locale, "common.generated-message-title")}
            copyButtonText={t(locale, "common.copy-button")}
            message={generatedMessage}
            onMessageChange={setGeneratedMessage}
            handleCopy={handleCopy}
          />
        )}
    </div>
  );
};

