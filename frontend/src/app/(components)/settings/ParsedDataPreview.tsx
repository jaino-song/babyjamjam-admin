"use client";

import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Alert,
  Chip,
  IconButton,
  Tooltip,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import WarningIcon from "@mui/icons-material/Warning";
import EditIcon from "@mui/icons-material/Edit";
import { useState, useCallback } from "react";
import { ParsedVoucherPriceItem } from "@/app/hooks/useVoucherPriceImageParsing";
import { PriceEditModal } from "./PriceEditModal";

interface ParsedDataPreviewProps {
  data: ParsedVoucherPriceItem[];
  warnings: string[];
  onDataChange?: (updatedData: ParsedVoucherPriceItem[]) => void;
}

// 가격 문자열을 숫자로 변환
function parsePrice(price: string): number {
  return parseInt(price.replace(/[,원\s]/g, ""), 10) || 0;
}

// 숫자를 포맷팅된 문자열로 변환
function formatPrice(price: string | number): string {
  const num = typeof price === "string" ? parsePrice(price) : price;
  return num.toLocaleString("ko-KR");
}

// 단일 행의 수학적 검증
function validateRow(item: ParsedVoucherPriceItem): boolean {
  const fullPrice = parsePrice(item.fullPrice);
  const grant = parsePrice(item.grant);
  const actualPrice = parsePrice(item.actualPrice);
  return fullPrice === grant + actualPrice;
}

export function ParsedDataPreview({
  data,
  warnings,
  onDataChange,
}: ParsedDataPreviewProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const handleStartEdit = useCallback((index: number) => {
    setEditingIndex(index);
    setModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setModalOpen(false);
    setEditingIndex(null);
  }, []);

  const handleSaveEdit = useCallback((updatedItem: ParsedVoucherPriceItem) => {
    if (editingIndex === null || !onDataChange) return;

    const newData = [...data];
    newData[editingIndex] = updatedItem;
    onDataChange(newData);
  }, [editingIndex, data, onDataChange]);

  if (data.length === 0) {
    return (
      <Alert severity="warning">
        파싱된 데이터가 없습니다. 이미지를 확인해주세요.
      </Alert>
    );
  }

  return (
    <Box>
      {/* 경고 메시지 */}
      {warnings.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
            검증 경고 ({warnings.length}건)
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2 }}>
            {warnings.map((warning, index) => (
              <li key={index}>
                <Typography variant="body2">{warning}</Typography>
              </li>
            ))}
          </Box>
        </Alert>
      )}

      {/* 요약 정보 */}
      <Box sx={{ mb: 2, display: "flex", gap: 2, flexWrap: "wrap" }}>
        <Chip
          icon={<CheckCircleIcon />}
          label={`총 ${data.length}개 항목`}
          color="primary"
          variant="outlined"
        />
        {warnings.length === 0 ? (
          <Chip
            icon={<CheckCircleIcon />}
            label="검증 통과"
            color="success"
            variant="outlined"
          />
        ) : (
          <Chip
            icon={<WarningIcon />}
            label={`${warnings.length}개 경고`}
            color="warning"
            variant="outlined"
          />
        )}
      </Box>

      {/* 데이터 테이블 */}
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ backgroundColor: "action.hover" }}>
              <TableCell>유형</TableCell>
              <TableCell align="right">기간 (일)</TableCell>
              <TableCell align="right">서비스가격</TableCell>
              <TableCell align="right">정부지원금</TableCell>
              <TableCell align="right">본인부담금</TableCell>
              <TableCell align="center" width={80}>
                검증
              </TableCell>
              {onDataChange && (
                <TableCell align="center" width={80}>
                  수정
                </TableCell>
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {data.map((item, index) => {
              const isValid = validateRow(item);

              return (
                <TableRow
                  key={`voucher-row-${index}`}
                  sx={{
                    backgroundColor: isValid ? "inherit" : "warning.light",
                    "&:hover": {
                      backgroundColor: isValid
                        ? "action.hover"
                        : "warning.main",
                    },
                  }}
                >
                  {/* 유형 */}
                  <TableCell sx={{ px: 1 }}>
                    <Typography variant="body2" fontWeight="medium">
                      {item.type}
                    </Typography>
                  </TableCell>

                  {/* 기간 */}
                  <TableCell align="right" sx={{ px: 1 }}>
                    {item.duration}일
                  </TableCell>

                  {/* 서비스가격 */}
                  <TableCell align="right" sx={{ px: 1 }}>
                    {formatPrice(item.fullPrice)}원
                  </TableCell>

                  {/* 정부지원금 */}
                  <TableCell align="right" sx={{ px: 1 }}>
                    {formatPrice(item.grant)}원
                  </TableCell>

                  {/* 본인부담금 */}
                  <TableCell align="right" sx={{ px: 1 }}>
                    {formatPrice(item.actualPrice)}원
                  </TableCell>

                  {/* 검증 상태 */}
                  <TableCell align="center" sx={{ px: 1 }}>
                    {isValid ? (
                      <Tooltip title="가격 계산 일치">
                        <CheckCircleIcon color="success" fontSize="small" />
                      </Tooltip>
                    ) : (
                      <Tooltip title="가격 계산 불일치: 서비스가격 ≠ 정부지원금 + 본인부담금">
                        <WarningIcon color="warning" fontSize="small" />
                      </Tooltip>
                    )}
                  </TableCell>

                  {/* 수정 버튼 */}
                  {onDataChange && (
                    <TableCell align="center" sx={{ px: 1 }}>
                      <IconButton
                        size="small"
                        onClick={() => handleStartEdit(index)}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {/* 수식 설명 */}
      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
        * 검증 수식: 서비스가격 = 정부지원금 + 본인부담금
      </Typography>

      {/* 가격 수정 모달 */}
      <PriceEditModal
        open={modalOpen}
        item={editingIndex !== null ? data[editingIndex] : null}
        onClose={handleCloseModal}
        onSave={handleSaveEdit}
      />
    </Box>
  );
}
