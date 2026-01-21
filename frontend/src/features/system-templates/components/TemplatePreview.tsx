'use client';

import { useMemo, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  IconButton,
  Tooltip,
  Divider,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { ContentCopy as CopyIcon } from '@mui/icons-material';
import voucherOptions from '@/app/(components)/messages/templates/json/voucher.json';
import { useVoucherPriceInfos } from '@/app/hooks';
import { renderTemplate } from '@/lib/template-utils';

interface Props {
  content: string;
  data: Record<string, unknown>;
  templateKey?: string;
  label?: string;
}

export const SAMPLE_DATA: Record<string, Record<string, unknown>> = {
  PRICE_INFO: {
    name: '홍길동',
    weeks: 4,
    duration: '20',
    type: 'A가1형',
    fullPrice: '1,234,000',
    grant: '1,000,000',
    actualPrice: '234,000',
    bankName: '국민은행',
    accNum: '123-456-789012',
  },
  GREETING: {},
  THANKS: { name: '홍길동' },
  SURVEY: { name: '홍길동' },
  SERVICE_INFO: { name: '홍길동' },
  REMINDER: { name: '홍길동' },
  INFO: {},
};

function formatKoreanPrice(price: string | null | undefined): string {
  if (!price) return '';
  const num = Number(price.replace(/[,원\s]/g, ''));
  if (Number.isNaN(num)) return price;
  return num.toLocaleString('ko-KR');
}

function buildVoucherTypeLabelMap(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const group of Object.values(voucherOptions.voucherOptions)) {
    for (const [typeValue, typeData] of Object.entries(group)) {
      result[typeValue] = typeData.label;
    }
  }
  return result;
}

const voucherTypeLabelMap = buildVoucherTypeLabelMap();
const defaultVoucherType = Object.keys(voucherTypeLabelMap)[0] ?? '';

export function TemplatePreview({ content, data, templateKey, label = '미리보기' }: Props) {
  const [voucherType, setVoucherType] = useState<string>(defaultVoucherType);
  const [year, setYear] = useState<number>(new Date().getFullYear());

  const { data: voucherPriceInfos = [] } = useVoucherPriceInfos(voucherType, year);

  const selectedVoucherPriceInfo = useMemo(() => {
    if (templateKey !== 'PRICE_INFO') return null;
    if (voucherPriceInfos.length === 0) return null;

    return [...voucherPriceInfos].sort((a, b) => Number(b.duration) - Number(a.duration))[0] ?? null;
  }, [templateKey, voucherPriceInfos]);

  const previewData = useMemo(() => {
    if (templateKey !== 'PRICE_INFO' || !selectedVoucherPriceInfo) return data;

    const duration = selectedVoucherPriceInfo.duration;
    const durationNum = Number(duration);

    return {
      ...data,
      type: voucherTypeLabelMap[voucherType] ?? voucherType,
      duration,
      weeks: Number.isNaN(durationNum) ? data.weeks : Math.floor(durationNum / 5),
      fullPrice: formatKoreanPrice(selectedVoucherPriceInfo.fullPrice),
      grant: formatKoreanPrice(selectedVoucherPriceInfo.grant),
      actualPrice: formatKoreanPrice(selectedVoucherPriceInfo.actualPrice),
    };
  }, [data, selectedVoucherPriceInfo, templateKey, voucherType]);

  const renderedContent = useMemo(() => renderTemplate(content, previewData), [content, previewData]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(renderedContent);
  };

  const years = useMemo(() => [year - 1, year, year + 1], [year]);
  const isRealPricePreview = templateKey === 'PRICE_INFO' && !!selectedVoucherPriceInfo;

  return (
    <Paper sx={{ p: 2, minWidth: 300, bgcolor: 'grey.50', height: '100%' }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
        <Typography variant="subtitle2">{label}</Typography>
        <Tooltip title="복사">
          <IconButton size="small" onClick={handleCopy}>
            <CopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Divider sx={{ mb: 2 }} />

      {templateKey === 'PRICE_INFO' && (
        <Box mb={2}>
          <Typography variant="caption" color="primary">
            실제 데이터로 미리보기
          </Typography>
          <Box display="flex" gap={1} mt={1}>
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>바우처 유형</InputLabel>
              <Select
                value={voucherType}
                label="바우처 유형"
                onChange={(e) => setVoucherType(String(e.target.value))}
              >
                {Object.entries(voucherOptions.voucherOptions).flatMap(([groupName, types]) => [
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
            <FormControl size="small" sx={{ minWidth: 100 }}>
              <InputLabel>연도</InputLabel>
              <Select
                value={year}
                label="연도"
                onChange={(e) => setYear(Number(e.target.value))}
              >
                {years.map((y) => (
                  <MenuItem key={y} value={y}>
                    {y}년
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        </Box>
      )}

      <Typography
        variant="body2"
        sx={{
          whiteSpace: 'pre-wrap',
          fontFamily: 'inherit',
          lineHeight: 1.6,
          maxHeight: 400,
          overflow: 'auto',
        }}
      >
        {renderedContent}
      </Typography>

      <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
        {isRealPricePreview ? '※ 실제 가격 데이터로 렌더링됨' : '※ 예시 데이터로 렌더링됨'}
      </Typography>
    </Paper>
  );
}
