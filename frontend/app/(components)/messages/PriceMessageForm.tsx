"use client";
import { useState } from "react";
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
  TextField,
  Typography,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import voucherOptions from "./voucher.json";
import { api } from "@/app/lib/axios";
import { priceMsgTemplate } from "./templates/priceMsg";

interface PriceFormData {
  name: string;
  weeks: number;
  days: number;
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

const areaOptions = [
  { value: "Namdonggu", label: "남동구", bankName: "신한은행", accNum: "110-123-456789" },
  { value: "Seogu", label: "서구", bankName: "우리은행", accNum: "1002-234-567890" },
  { value: "Bupyunggu", label: "부평구", bankName: "국민은행", accNum: "123456-01-234567" },
  { value: "Yeonsu", label: "연수구", bankName: "하나은행", accNum: "789-456123-12345" },
];



export const PriceMessageForm = () => {
  const [formData, setFormData] = useState<PriceFormData>({
    name: "",
    weeks: 0,
    days: 0,
    type: "",
    voucherId: null,
    fullPrice: "",
    grant: "",
    actualPrice: "",
    area: "",
    bankName: "",
    accNum: "",
  });


  const [selectedType, setSelectedType] = useState("");
  const [availableDurations, setAvailableDurations] = useState<Record<string, { weeks: number; id: number }>>({});
  const [generatedMessage, setGeneratedMessage] = useState("");
  const [voucherPriceInfos, setVoucherPriceInfos] = useState<VoucherPriceInfo[]>([]);

  const handleVoucherPriceInfoFetch = async (type: string) => {
    try {
      const { data } = await api.get(`/voucher-price-infos/type`, {
        params: { type }
      });
      console.log('Fetched voucher prices:', data);
      setVoucherPriceInfos(data);
    } catch (error) {
      console.error('Error fetching voucher prices:', error);
    }
  };

  const handleVoucherTypeChange = (value: string) => {
    handleVoucherPriceInfoFetch(value);
    setSelectedType(value);
    
    // Find the selected voucher type and its durations in the object tree
    for (const types of Object.values(voucherOptions.voucherOptions)) {
      if (types[value as keyof typeof types]) {
        setAvailableDurations((types[value as keyof typeof types] as { durations: Record<string, { weeks: number; id: number }> }).durations);
        setFormData(prev => ({
          ...prev,
          type: value,
          weeks: 0,
          days: 0,
          voucherId: null,
        }));
        break;
      }
    }
  };

  const handleDurationChange = (days: number) => {
    const duration = availableDurations[days];
    if (duration) {
      setFormData(prev => ({
        ...prev,
        weeks: duration.weeks,
        days: Number(days),
        voucherId: duration.id,
      }));
    }
  };

  const handleVoucherIdChange = (id: number) => {
    const selected = voucherPriceInfos.find(v => v.id === id);
    if (selected) {
      setFormData(prev => ({
        ...prev,
        voucherId: selected.id,
        days: Number(selected.duration) || 0,
        // weeks are not provided by DB; keep existing value
        fullPrice: selected.fullPrice ?? "",
        grant: selected.grant ?? "",
        actualPrice: selected.actualPrice ?? "",
      }));
    }
  };

  const handleAreaChange = (value: string) => {
    const selected = areaOptions.find(opt => opt.value === value);
    
    if (selected) {
      setFormData(prev => ({
        ...prev,
        area: selected.value,
        bankName: selected.bankName,
        accNum: selected.accNum,
      }));
    }
  };

  const handleGenerate = () => {
    const message = priceMsgTemplate(formData);
    setGeneratedMessage(message);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedMessage);
    alert("메시지가 클립보드에 복사되었습니다!");
  };

  return (
    <Box sx={{ maxWidth: 1000, mx: "auto", p: 3 }}>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        금액 및 계좌번호 안내 문자 생성
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        해당 항목들을 모두 작성 및 선택 후에 하단에 있는 문자 생성 버튼을 클릭해 주세요
      </Typography>

      <Card elevation={0} sx={{ mb: 3 }}>
        <CardContent>
          <Stack spacing={3}>
            <TextField
              fullWidth
              label="산모님 성함"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="예: 홍길동"
            />

            <FormControl fullWidth>
              <InputLabel>바우처 유형</InputLabel>
              <Select
                value={selectedType}
                label="바우처 유형"
                onChange={(e) => handleVoucherTypeChange(e.target.value)}
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

            {voucherPriceInfos.length > 0 && (
              <FormControl fullWidth>
                <InputLabel>서비스 기간</InputLabel>
                <Select
                  value={formData.voucherId ?? ""}
                  label="서비스 기간"
                  onChange={(e) => handleVoucherIdChange(Number(e.target.value))}
                >
                  {voucherPriceInfos.map((v) => (
                    <MenuItem key={v.id} value={v.id}>
                      {v.duration}일
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            <FormControl fullWidth>
              <InputLabel>지역</InputLabel>
              <Select
                value={formData.area}
                label="지역"
                onChange={(e) => handleAreaChange(e.target.value)}
              >
                {areaOptions.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Button
              variant="contained"
              size="large"
              onClick={handleGenerate}
              disabled={!formData.name || !formData.type || !formData.area}
            >
              문자 생성
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {generatedMessage && (
        <Paper elevation={0} sx={{ p: 3, bgcolor: "grey.50" }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
            <Typography variant="h6" fontWeight={600}>
              생성된 메시지
            </Typography>
            <Button
              variant="outlined"
              size="small"
              startIcon={<ContentCopyIcon />}
              onClick={handleCopy}
            >
              복사
            </Button>
          </Stack>
          <Paper sx={{ p: 2, bgcolor: "white" }}>
            <Typography
              variant="body2"
              component="pre"
              sx={{ fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
            >
              {generatedMessage}
            </Typography>
          </Paper>
        </Paper>
      )}
    </Box>
  );
};

