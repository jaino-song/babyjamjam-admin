"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  Alert,
  InputAdornment,
} from "@mui/material";
import { ParsedVoucherPriceItem } from "@/app/hooks/useVoucherPriceImageParsing";

interface PriceEditModalProps {
  open: boolean;
  item: ParsedVoucherPriceItem | null;
  onClose: () => void;
  onSave: (updatedItem: ParsedVoucherPriceItem) => void;
}

// 가격 문자열을 숫자로 변환
function parsePrice(price: string): number {
  return parseInt(price.replace(/[,원\s]/g, ""), 10) || 0;
}

// 숫자를 포맷팅된 문자열로 변환
function formatPriceDisplay(value: number): string {
  return value.toLocaleString("ko-KR");
}

export function PriceEditModal({
  open,
  item,
  onClose,
  onSave,
}: PriceEditModalProps) {
  const [fullPrice, setFullPrice] = useState("");
  const [grant, setGrant] = useState("");
  const [actualPrice, setActualPrice] = useState("");

  // item이 변경되면 폼 값 초기화
  useEffect(() => {
    if (item) {
      setFullPrice(String(parsePrice(item.fullPrice)));
      setGrant(String(parsePrice(item.grant)));
      setActualPrice(String(parsePrice(item.actualPrice)));
    }
  }, [item]);

  const fullPriceNum = parseInt(fullPrice, 10) || 0;
  const grantNum = parseInt(grant, 10) || 0;
  const actualPriceNum = parseInt(actualPrice, 10) || 0;
  const calculatedSum = grantNum + actualPriceNum;
  const isValid = fullPriceNum === calculatedSum;
  const difference = fullPriceNum - calculatedSum;

  const handleSave = useCallback(() => {
    if (!item) return;

    onSave({
      ...item,
      fullPrice: fullPrice,
      grant: grant,
      actualPrice: actualPrice,
    });
    onClose();
  }, [item, fullPrice, grant, actualPrice, onSave, onClose]);

  const handleNumberInput = (
    value: string,
    setter: (v: string) => void
  ) => {
    // 숫자만 허용
    const numericValue = value.replace(/[^\d]/g, "");
    setter(numericValue);
  };

  // 자동 계산 버튼: actualPrice = fullPrice - grant
  const handleAutoCalculate = useCallback(() => {
    const calculated = fullPriceNum - grantNum;
    setActualPrice(String(Math.max(0, calculated)));
  }, [fullPriceNum, grantNum]);

  if (!item) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        가격 수정
        <Typography variant="body2" color="text.secondary">
          {item.type} · {item.duration}일
        </Typography>
      </DialogTitle>

      <DialogContent dividers>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 3, pt: 1 }}>
          {/* 서비스가격 */}
          <TextField
            label="서비스가격"
            value={fullPrice}
            onChange={(e) => handleNumberInput(e.target.value, setFullPrice)}
            InputProps={{
              endAdornment: <InputAdornment position="end">원</InputAdornment>,
            }}
            helperText={`표시: ${formatPriceDisplay(fullPriceNum)}원`}
            fullWidth
          />

          {/* 정부지원금 */}
          <TextField
            label="정부지원금"
            value={grant}
            onChange={(e) => handleNumberInput(e.target.value, setGrant)}
            InputProps={{
              endAdornment: <InputAdornment position="end">원</InputAdornment>,
            }}
            helperText={`표시: ${formatPriceDisplay(grantNum)}원`}
            fullWidth
          />

          {/* 본인부담금 */}
          <Box>
            <TextField
              label="본인부담금"
              value={actualPrice}
              onChange={(e) => handleNumberInput(e.target.value, setActualPrice)}
              InputProps={{
                endAdornment: <InputAdornment position="end">원</InputAdornment>,
              }}
              helperText={`표시: ${formatPriceDisplay(actualPriceNum)}원`}
              fullWidth
            />
            <Button
              size="small"
              onClick={handleAutoCalculate}
              sx={{ mt: 1 }}
              variant="text"
            >
              자동 계산 (서비스가격 - 정부지원금)
            </Button>
          </Box>

          {/* 검증 결과 */}
          <Box sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              검증: 서비스가격 = 정부지원금 + 본인부담금
            </Typography>
            <Typography variant="body1">
              {formatPriceDisplay(fullPriceNum)} = {formatPriceDisplay(grantNum)} + {formatPriceDisplay(actualPriceNum)} = {formatPriceDisplay(calculatedSum)}
            </Typography>

            {isValid ? (
              <Alert severity="success" sx={{ mt: 1 }}>
                가격 계산이 일치합니다.
              </Alert>
            ) : (
              <Alert severity="warning" sx={{ mt: 1 }}>
                가격 불일치: 차이 {formatPriceDisplay(Math.abs(difference))}원
                {difference > 0 ? " (서비스가격이 더 큼)" : " (합계가 더 큼)"}
              </Alert>
            )}
          </Box>
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} color="inherit">
          취소
        </Button>
        <Button onClick={handleSave} variant="contained" color="primary">
          저장
        </Button>
      </DialogActions>
    </Dialog>
  );
}
