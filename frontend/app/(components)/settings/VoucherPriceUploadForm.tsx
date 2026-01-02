"use client";

import { useState, useCallback } from "react";
import {
  Box,
  Paper,
  Typography,
  Button,
  Stepper,
  Step,
  StepLabel,
  Alert,
  CircularProgress,
  Divider,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RefreshIcon from "@mui/icons-material/Refresh";
import { ImageDropzone } from "./ImageDropzone";
import { ParsedDataPreview } from "./ParsedDataPreview";
import {
  useParseVoucherImage,
  useBulkUpdateVoucherPrices,
  ParsedVoucherPriceItem,
} from "@/app/hooks/useVoucherPriceImageParsing";

type Step = "upload" | "preview" | "success";

const steps = ["이미지 업로드", "데이터 확인", "완료"];

// 연도 선택 옵션 생성 (현재 연도 기준 -1 ~ +2)
const generateYearOptions = (): number[] => {
  const currentYear = new Date().getFullYear();
  return [currentYear - 1, currentYear, currentYear + 1, currentYear + 2];
};

export function VoucherPriceUploadForm() {
  const [currentStep, setCurrentStep] = useState<Step>("upload");
  const [parsedData, setParsedData] = useState<ParsedVoucherPriceItem[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [updateResult, setUpdateResult] = useState<{
    updated: number[];
    created: number[];
    errors: string[];
  } | null>(null);

  const parseImageMutation = useParseVoucherImage();
  const bulkUpdateMutation = useBulkUpdateVoucherPrices();
  const yearOptions = generateYearOptions();

  const getStepIndex = (step: Step): number => {
    switch (step) {
      case "upload":
        return 0;
      case "preview":
        return 1;
      case "success":
        return 2;
      default:
        return 0;
    }
  };

  const handleFileSelect = useCallback(
    async (file: File) => {
      try {
        const result = await parseImageMutation.mutateAsync(file);
        setParsedData(result.parsedData ?? []);
        setWarnings(result.warnings ?? []);
        setCurrentStep("preview");
      } catch (error) {
        console.error("Image parsing failed:", error);
      }
    },
    [parseImageMutation],
  );

  const handleDataChange = useCallback((updatedData: ParsedVoucherPriceItem[]) => {
    setParsedData(updatedData);
    // 변경 후 경고 메시지 재계산
    const newWarnings: string[] = [];
    updatedData.forEach((item, index) => {
      const fullPrice = parseInt(item.fullPrice.replace(/[,원\s]/g, ""), 10) || 0;
      const grant = parseInt(item.grant.replace(/[,원\s]/g, ""), 10) || 0;
      const actualPrice = parseInt(item.actualPrice.replace(/[,원\s]/g, ""), 10) || 0;

      if (fullPrice !== grant + actualPrice) {
        newWarnings.push(
          `행 ${index + 1} (${item.type}, ${item.duration}일): 가격 계산 불일치`,
        );
      }
    });
    setWarnings(newWarnings);
  }, []);

  const handleConfirmUpdate = useCallback(async () => {
    try {
      const result = await bulkUpdateMutation.mutateAsync({
        items: parsedData,
        year: selectedYear,
      });
      setUpdateResult(result);
      setCurrentStep("success");
    } catch (error) {
      console.error("Bulk update failed:", error);
    }
  }, [bulkUpdateMutation, parsedData, selectedYear]);

  const handleReset = useCallback(() => {
    setCurrentStep("upload");
    setParsedData([]);
    setWarnings([]);
    setSelectedYear(new Date().getFullYear());
    setUpdateResult(null);
    parseImageMutation.reset();
    bulkUpdateMutation.reset();
  }, [parseImageMutation, bulkUpdateMutation]);

  const handleBackToUpload = useCallback(() => {
    setCurrentStep("upload");
    setParsedData([]);
    setWarnings([]);
    parseImageMutation.reset();
  }, [parseImageMutation]);

  return (
    <Paper elevation={2} sx={{ p: 3 }}>
      {/* 헤더 */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          바우처 요금표 업데이트
        </Typography>
        <Typography variant="body2" color="text.secondary">
          정부지원 바우처 요금표 이미지를 업로드하면 AI가 자동으로 가격 정보를
          추출합니다.
        </Typography>
      </Box>

      {/* Stepper */}
      <Stepper activeStep={getStepIndex(currentStep)} sx={{ mb: 4 }}>
        {steps.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      <Divider sx={{ mb: 3 }} />

      {/* Step 1: 이미지 업로드 */}
      {currentStep === "upload" && (
        <Box>
          <ImageDropzone
            onFileSelect={handleFileSelect}
            isLoading={parseImageMutation.isPending}
            error={
              parseImageMutation.isError
                ? parseImageMutation.error?.message ||
                  "이미지 파싱에 실패했습니다"
                : null
            }
          />
        </Box>
      )}

      {/* Step 2: 데이터 미리보기 */}
      {currentStep === "preview" && (
        <Box>
          {/* 연도 선택 */}
          <Box sx={{ mb: 3, display: "flex", alignItems: "center", gap: 2 }}>
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel id="year-select-label">적용 연도</InputLabel>
              <Select
                labelId="year-select-label"
                value={selectedYear}
                label="적용 연도"
                onChange={(e) => setSelectedYear(Number(e.target.value))}
              >
                {yearOptions.map((year) => (
                  <MenuItem key={year} value={year}>
                    {year}년
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Typography variant="body2" color="text.secondary">
              선택한 연도의 요금표로 업데이트됩니다.
            </Typography>
          </Box>

          <ParsedDataPreview
            data={parsedData}
            warnings={warnings}
            onDataChange={handleDataChange}
          />

          {/* 액션 버튼 */}
          <Box
            sx={{
              mt: 3,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Button variant="outlined" onClick={handleBackToUpload}>
              다른 이미지 업로드
            </Button>

            <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
              {warnings.length > 0 && (
                <Alert severity="warning" sx={{ py: 0 }}>
                  경고가 있지만 업데이트를 진행할 수 있습니다
                </Alert>
              )}
              <Button
                variant="contained"
                color="primary"
                onClick={handleConfirmUpdate}
                disabled={bulkUpdateMutation.isPending || parsedData.length === 0}
                startIcon={
                  bulkUpdateMutation.isPending ? (
                    <CircularProgress size={20} />
                  ) : (
                    <CloudUploadIcon />
                  )
                }
              >
                {bulkUpdateMutation.isPending ? "업데이트 중..." : `${selectedYear}년 요금표 업데이트`}
              </Button>
            </Box>
          </Box>

          {/* 업데이트 에러 */}
          {bulkUpdateMutation.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              업데이트 실패:{" "}
              {bulkUpdateMutation.error?.message || "알 수 없는 오류"}
            </Alert>
          )}
        </Box>
      )}

      {/* Step 3: 완료 */}
      {currentStep === "success" && updateResult && (
        <Box
          sx={{
            textAlign: "center",
            py: 4,
          }}
        >
          <CheckCircleIcon
            sx={{ fontSize: 64, color: "success.main", mb: 2 }}
          />
          <Typography variant="h6" gutterBottom>
            업데이트 완료!
          </Typography>

          <Box sx={{ my: 3 }}>
            <Typography variant="body1">
              <strong>{updateResult.updated.length}</strong>개 항목 업데이트,{" "}
              <strong>{updateResult.created.length}</strong>개 항목 신규 생성
            </Typography>
          </Box>

          {updateResult.errors.length > 0 && (
            <Alert severity="warning" sx={{ mb: 3, textAlign: "left" }}>
              <Typography variant="subtitle2" gutterBottom>
                일부 항목 처리 실패:
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2 }}>
                {updateResult.errors.map((error, index) => (
                  <li key={index}>
                    <Typography variant="body2">{error}</Typography>
                  </li>
                ))}
              </Box>
            </Alert>
          )}

          <Button
            variant="outlined"
            onClick={handleReset}
            startIcon={<RefreshIcon />}
          >
            새 요금표 업로드
          </Button>
        </Box>
      )}
    </Paper>
  );
}
