"use client";

import { useMemo, useState } from "react";
import {
    Alert,
    Box,
    Button,
    Checkbox,
    CircularProgress,
    Divider,
    FormControl,
    FormControlLabel,
    InputLabel,
    MenuItem,
    Select,
    Step,
    StepLabel,
    Stepper,
    TextField,
    Typography,
} from "@mui/material";
import { useVoucherPriceInfos, useVoucherYears } from "@/app/hooks/useVoucherData";
import voucherOptions from "@/app/(components)/messages/templates/json/voucher.json";

export type CreatedClient = {
    id: number;
    name: string;
};

interface ClientRegistrationWizardProps {
    onCreated?: (client: CreatedClient) => void;
}

const steps = ["기본 정보", "바우처 정보", "설정"] as const;

const WIZARD_MIN_HEIGHT_PX = 520;

function formatPhoneNumber(value: string): string {
    const digits = value.replace(/\D/g, "");
    if (digits.length <= 3) return digits;
    if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
}

function formatPrice(price: string): string {
    const num = parseInt(price.replace(/[,원\s]/g, ""), 10);
    if (Number.isNaN(num)) return price;
    return num.toLocaleString("ko-KR");
}

export function ClientRegistrationWizard({ onCreated }: ClientRegistrationWizardProps) {
    const [activeStep, setActiveStep] = useState(0);

    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [birthday, setBirthday] = useState("");
    const [address, setAddress] = useState("");
    const [dueDate, setDueDate] = useState("");

    const [voucherClient, setVoucherClient] = useState(true);
    const { data: voucherYears = [], isLoading: isVoucherYearsLoading } = useVoucherYears();
    const [voucherYear, setVoucherYear] = useState<number | null>(null);
    const [voucherType, setVoucherType] = useState("");
    const [voucherDuration, setVoucherDuration] = useState("");
    const [fullPrice, setFullPrice] = useState("");
    const [grant, setGrant] = useState("");
    const [actualPrice, setActualPrice] = useState("");

    const resolvedVoucherYear = useMemo(() => {
        if (voucherYear !== null) return voucherYear;
        if (voucherYears.length === 0) return null;
        return Math.max(...voucherYears);
    }, [voucherYear, voucherYears]);

    const { data: voucherPriceInfos = [], isLoading: isVoucherPriceInfosLoading } = useVoucherPriceInfos(
        voucherType,
        resolvedVoucherYear ?? undefined,
    );

    const [careCenter, setCareCenter] = useState(false);
    const [breastPump, setBreastPump] = useState(false);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    const isVoucherInfoComplete =
        resolvedVoucherYear !== null &&
        voucherType.trim().length > 0 &&
        voucherDuration.trim().length > 0 &&
        fullPrice.trim().length > 0 &&
        grant.trim().length > 0 &&
        actualPrice.trim().length > 0;

    const canGoNext = useMemo(() => {
        if (activeStep === 0) {
            return (
                name.trim().length > 0 &&
                phone.trim().length > 0 &&
                birthday.trim().length > 0 &&
                address.trim().length > 0 &&
                dueDate.trim().length > 0
            );
        }
        if (activeStep === 1) {
            if (!voucherClient) return true;
            return isVoucherInfoComplete;
        }
        return true;
    }, [activeStep, name, phone, birthday, address, dueDate, voucherClient, isVoucherInfoComplete]);

    const handleNext = () => {
        if (!canGoNext) return;
        setActiveStep((s) => Math.min(s + 1, steps.length - 1));
    };

    const handleBack = () => {
        setActiveStep((s) => Math.max(s - 1, 0));
    };

    const handleVoucherYearChange = (year: number) => {
        setVoucherYear(year);
        setVoucherType("");
        setVoucherDuration("");
        setFullPrice("");
        setGrant("");
        setActualPrice("");
    };

    const handleVoucherTypeChange = (type: string) => {
        setVoucherType(type);
        setVoucherDuration("");
        setFullPrice("");
        setGrant("");
        setActualPrice("");
    };

    const handleVoucherDurationChange = (duration: string) => {
        const selected = voucherPriceInfos.find((v) => v.duration === duration);
        if (!selected) return;

        setVoucherDuration(duration);
        setFullPrice(selected.fullPrice?.toString() ?? "");
        setGrant(selected.grant?.toString() ?? "");
        setActualPrice(selected.actualPrice?.toString() ?? "");
    };

    const handleSubmit = async () => {
        if (!name.trim()) return;

        if (voucherClient && !isVoucherInfoComplete) {
            setSubmitError("바우처 정보를 입력해주세요.");
            return;
        }

        setIsSubmitting(true);
        setSubmitError(null);

        try {
            const payload: Record<string, unknown> = {
                name: name.trim(),
                phone: phone.trim(),
                birthday: birthday.trim(),
                address: address.trim(),
                dueDate: dueDate.trim(),
                careCenter,
                voucherClient,
                breastPump,
            };

            if (voucherClient) {
                payload.type = voucherType;

                const durationNumber = Number(voucherDuration);
                if (!Number.isNaN(durationNumber)) {
                    payload.duration = durationNumber;
                }

                payload.fullPrice = fullPrice;
                payload.grant = grant;
                payload.actualPrice = actualPrice;
            }

            const res = await fetch("/api/clients", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                let message = "등록에 실패했습니다.";
                try {
                    const errJson = await res.json();
                    if (typeof errJson?.error === "string") {
                        message = `등록에 실패했습니다: ${errJson.error}`;
                    }
                } catch {
                    // ignore parse errors
                }
                throw new Error(message);
            }

            const created = (await res.json()) as CreatedClient;
            onCreated?.(created);
        } catch (e) {
            const msg = e instanceof Error ? e.message : "등록에 실패했습니다.";
            setSubmitError(msg);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Box sx={{ minHeight: WIZARD_MIN_HEIGHT_PX, display: "flex", flexDirection: "column" }}>
            <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                    산모 등록
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    필요한 정보만 빠르게 입력해 등록할 수 있어요.
                </Typography>
            </Box>

            <Stepper activeStep={activeStep} sx={{ mb: 2 }}>
                {steps.map((label) => (
                    <Step key={label}>
                        <StepLabel>{label}</StepLabel>
                    </Step>
                ))}
            </Stepper>

            <Box sx={{ flex: 1, minHeight: 0 }}>
                {activeStep === 0 && (
                    <Box sx={{ display: "grid", gap: 2 }}>
                        <TextField
                            label="이름"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            autoFocus
                        />
                        <TextField
                            type="date"
                            label="출산 예정일"
                            value={dueDate}
                            onChange={(e) => setDueDate(e.target.value)}
                            InputLabelProps={{ shrink: true }}
                        />
                        <TextField
                            label="연락처"
                            value={phone}
                            onChange={(e) => setPhone(formatPhoneNumber(e.target.value))}
                            placeholder="010-1234-5678"
                            inputProps={{ maxLength: 13 }}
                        />
                        <TextField
                            label="생년월일"
                            value={birthday}
                            onChange={(e) => setBirthday(e.target.value)}
                            placeholder="YYMMDD"
                            inputProps={{ maxLength: 6 }}
                        />
                        <TextField label="주소" value={address} onChange={(e) => setAddress(e.target.value)} />
                    </Box>
                )}

                {activeStep === 1 && (
                    <Box sx={{ display: "grid", gap: 2 }}>
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={voucherClient}
                                    onChange={(e) => setVoucherClient(e.target.checked)}
                                />
                            }
                            label="바우처 대상"
                        />

                        {voucherClient && (
                            <>
                                <Box sx={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap" }}>
                                    <FormControl size="small" sx={{ minWidth: 140 }}>
                                        <InputLabel id="client-wizard-voucher-year-label">바우처 연도</InputLabel>
                                        <Select
                                            labelId="client-wizard-voucher-year-label"
                                            id="client-wizard-voucher-year"
                                            label="바우처 연도"
                                            value={resolvedVoucherYear ?? ""}
                                            onChange={(e) => handleVoucherYearChange(Number(e.target.value))}
                                            disabled={isVoucherYearsLoading}
                                        >
                                            {voucherYears.map((year) => (
                                                <MenuItem key={year} value={year}>
                                                    {year}년
                                                </MenuItem>
                                            ))}
                                        </Select>
                                    </FormControl>
                                </Box>

                                <FormControl fullWidth disabled={resolvedVoucherYear === null}>
                                    <InputLabel id="client-wizard-voucher-type-label">바우처 유형</InputLabel>
                                    <Select
                                        labelId="client-wizard-voucher-type-label"
                                        id="client-wizard-voucher-type"
                                        label="바우처 유형"
                                        value={voucherType}
                                        onChange={(e) => handleVoucherTypeChange(String(e.target.value))}
                                    >
                                        {Object.entries(voucherOptions.voucherOptions).map(([groupName, types]) => [
                                            <MenuItem key={groupName} disabled sx={{ fontWeight: 600 }}>
                                                {groupName}
                                            </MenuItem>,
                                            ...Object.entries(types).map(([typeValue, typeData]) => (
                                                <MenuItem key={typeValue} value={typeValue} sx={{ pl: 4 }}>
                                                    {typeData.label}
                                                </MenuItem>
                                            )),
                                        ])}
                                    </Select>
                                </FormControl>

                                {voucherType && (
                                    <FormControl fullWidth disabled={isVoucherPriceInfosLoading || voucherPriceInfos.length === 0}>
                                        <InputLabel id="client-wizard-voucher-duration-label">기간</InputLabel>
                                        <Select
                                            labelId="client-wizard-voucher-duration-label"
                                            id="client-wizard-voucher-duration"
                                            label="기간"
                                            value={voucherDuration}
                                            onChange={(e) => handleVoucherDurationChange(String(e.target.value))}
                                        >
                                            {voucherPriceInfos.map((v) => (
                                                <MenuItem key={v.duration} value={v.duration}>
                                                    {v.duration}일
                                                </MenuItem>
                                            ))}
                                        </Select>
                                    </FormControl>
                                )}

                                {voucherType && isVoucherPriceInfosLoading && (
                                    <Box sx={{ display: "flex", justifyContent: "center", py: 1 }}>
                                        <CircularProgress size={18} />
                                    </Box>
                                )}

                                {voucherDuration && fullPrice && grant && actualPrice && (
                                    <>
                                        <Divider />
                                        <Box sx={{ display: "grid", gap: 0.75 }}>
                                            <Typography variant="body2" color="text.secondary">
                                                총액: {formatPrice(fullPrice)}원
                                            </Typography>
                                            <Typography variant="body2" color="text.secondary">
                                                정부지원금: {formatPrice(grant)}원
                                            </Typography>
                                            <Typography variant="body2" color="text.secondary">
                                                본인부담금: {formatPrice(actualPrice)}원
                                            </Typography>
                                        </Box>
                                    </>
                                )}
                            </>
                        )}
                    </Box>
                )}

                {activeStep === 2 && (
                    <Box sx={{ display: "grid", gap: 1 }}>
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={careCenter}
                                    onChange={(e) => setCareCenter(e.target.checked)}
                                />
                            }
                            label="조리원 여부"
                        />
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={breastPump}
                                    onChange={(e) => setBreastPump(e.target.checked)}
                                />
                            }
                            label="유축기"
                        />
                    </Box>
                )}
            </Box>

            {submitError && (
                <Alert severity="error" sx={{ mt: 2 }}>
                    {submitError}
                </Alert>
            )}

            <Box sx={{ display: "flex", justifyContent: "space-between", mt: 2 }}>
                <Button onClick={handleBack} disabled={activeStep === 0 || isSubmitting}>
                    이전
                </Button>

                {activeStep < steps.length - 1 ? (
                    <Button variant="contained" onClick={handleNext} disabled={!canGoNext || isSubmitting}>
                        다음
                    </Button>
                ) : (
                    <Button
                        variant="contained"
                        onClick={handleSubmit}
                        disabled={isSubmitting || !name.trim() || (voucherClient && !isVoucherInfoComplete)}
                    >
                        제출
                    </Button>
                )}
            </Box>
        </Box>
    );
}

export default ClientRegistrationWizard;
