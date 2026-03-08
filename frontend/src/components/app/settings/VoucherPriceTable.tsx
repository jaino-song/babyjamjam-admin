"use client";

import { useState, useMemo, useCallback } from "react";
import { useAllVoucherPriceInfos, useVoucherYears } from "@/hooks";
import { ContentPaper } from "@/components/app/root/content-paper";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";

function formatTypeLabel(typeCode: string | null): string {
  if (!typeCode) return "-";
  return typeCode.replace(/([가-힣])(\d)/, "$1-$2");
}

function formatPrice(price: string | null): string {
  if (!price) return "-";
  const num = parseInt(price.replace(/[,원\s]/g, ""), 10);
  if (isNaN(num)) return price;
  return num.toLocaleString("ko-KR") + "원";
}

/** Parse type code into parts: category (A/B/C/D), subtype (가/통합/라), grade (1/2/3) */
function parseTypeCode(typeCode: string | null) {
  if (!typeCode) return { category: null, subtype: null, grade: null };
  const match = typeCode.match(/^([A-D])(가|통합|라)(\d)형?$/);
  if (!match) return { category: null, subtype: null, grade: null };
  return { category: match[1], subtype: match[2], grade: match[3] };
}

function PillToggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors min-w-[3.25rem] text-center",
        "border-[hsl(var(--v3-primary))]",
        active
          ? "bg-[hsl(var(--v3-primary))] text-white"
          : "text-[hsl(var(--v3-primary))] hover:bg-[hsl(var(--v3-primary))]/10",
      )}
    >
      {label}
    </button>
  );
}

function useToggleSet<T>(initial: T[]) {
  const [selected, setSelected] = useState<Set<T>>(new Set(initial));

  const toggle = useCallback((value: T) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  return [selected, toggle, clear] as const;
}

function TableSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

const CATEGORIES = ["A", "B", "C", "D"] as const;
const SUBTYPES = ["가", "통합", "라"] as const;
const GRADES = ["1", "2", "3"] as const;
const DURATIONS = [5, 10, 15, 20, 25, 40] as const;

export function VoucherPriceTable() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);

  const { data: years = [], isLoading: isYearsLoading } = useVoucherYears();
  const { data: prices = [], isLoading: isPricesLoading } = useAllVoucherPriceInfos(selectedYear);

  const yearOptions = years.length > 0
    ? years
    : [currentYear - 1, currentYear, currentYear + 1];

  const [selectedCategories, toggleCategory] = useToggleSet<string>([]);
  const [selectedSubtypes, toggleSubtype] = useToggleSet<string>([]);
  const [selectedGrades, toggleGrade] = useToggleSet<string>([]);
  const [selectedDurations, toggleDuration, clearDurations] = useToggleSet<number>([]);

  const sortedPrices = useMemo(
    () => [...prices].sort((a, b) => {
      const labelA = formatTypeLabel(a.type);
      const labelB = formatTypeLabel(b.type);
      if (labelA !== labelB) return labelA.localeCompare(labelB, "ko");
      return Number(a.duration) - Number(b.duration);
    }),
    [prices],
  );

  const filteredPrices = useMemo(() => {
    const hasCategory = selectedCategories.size > 0;
    const hasSubtype = selectedSubtypes.size > 0;
    const hasGrade = selectedGrades.size > 0;
    const hasDuration = selectedDurations.size > 0;

    if (!hasCategory && !hasSubtype && !hasGrade && !hasDuration) {
      return sortedPrices;
    }

    return sortedPrices.filter((price) => {
      const { category, subtype, grade } = parseTypeCode(price.type);
      const duration = Number(price.duration);

      if (hasCategory && (!category || !selectedCategories.has(category))) return false;
      if (hasSubtype && (!subtype || !selectedSubtypes.has(subtype))) return false;
      if (hasGrade && (!grade || !selectedGrades.has(grade))) return false;
      if (hasDuration && !selectedDurations.has(duration)) return false;

      return true;
    });
  }, [sortedPrices, selectedCategories, selectedSubtypes, selectedGrades, selectedDurations]);

  const isFiltered = selectedCategories.size > 0 || selectedSubtypes.size > 0 || selectedGrades.size > 0 || selectedDurations.size > 0;

  return (
    <ContentPaper variant="v3" className="h-full [&>div]:h-full">
      <div data-component="voucher-price-table" className="flex flex-col h-full">
      <div className="shrink-0 mb-4 flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[hsl(var(--v3-primary))]/10">
          <CreditCard size={20} className="text-[hsl(var(--v3-primary))]" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-foreground">바우처 요금표</h2>
          <p className="text-sm text-muted-foreground">연도별 바우처 가격 정보를 확인합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="price-table-year" className="text-sm whitespace-nowrap">연도</Label>
          <Select
            value={String(selectedYear)}
            onValueChange={(v) => setSelectedYear(Number(v))}
            disabled={isYearsLoading}
          >
            <SelectTrigger id="price-table-year" className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((year) => (
                <SelectItem key={year} value={String(year)}>
                  {year}년
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Separator className="shrink-0 mb-4" />

      <div className="shrink-0 mb-4 space-y-3">
        <div className="flex items-center gap-3">
          <Label className="text-sm font-medium text-muted-foreground w-10 shrink-0">유형</Label>
          <div className="flex items-center gap-1.5">
            {CATEGORIES.map((cat) => (
              <PillToggle
                key={cat}
                label={cat}
                active={selectedCategories.has(cat)}
                onClick={() => toggleCategory(cat)}
              />
            ))}
          </div>
          <Separator orientation="vertical" className="h-6" />
          <div className="flex items-center gap-1.5">
            {SUBTYPES.map((sub) => (
              <PillToggle
                key={sub}
                label={sub}
                active={selectedSubtypes.has(sub)}
                onClick={() => toggleSubtype(sub)}
              />
            ))}
          </div>
          <Separator orientation="vertical" className="h-6" />
          <div className="flex items-center gap-1.5">
            {GRADES.map((g) => (
              <PillToggle
                key={g}
                label={`${g}형`}
                active={selectedGrades.has(g)}
                onClick={() => toggleGrade(g)}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Label className="text-sm font-medium text-muted-foreground w-10 shrink-0">기간</Label>
          <div className="flex items-center gap-1.5">
            {DURATIONS.map((d) => (
              <PillToggle
                key={d}
                label={`${d}일`}
                active={selectedDurations.has(d)}
                onClick={() => toggleDuration(d)}
              />
            ))}
          </div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={clearDurations}
            className="rounded-full border border-[hsl(var(--v3-primary))]/30 px-3 py-1 text-xs font-medium text-[hsl(var(--v3-primary))] hover:bg-[hsl(var(--v3-primary))]/10 transition-colors"
          >
            모두 해제
          </button>
        </div>
      </div>

      <Separator className="shrink-0 mb-4" />

      {isPricesLoading ? (
        <TableSkeleton />
      ) : prices.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <CreditCard size={40} className="mb-3 opacity-30" />
          <p className="text-sm">{selectedYear}년 요금 데이터가 없습니다.</p>
        </div>
      ) : filteredPrices.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <CreditCard size={40} className="mb-3 opacity-30" />
          <p className="text-sm">선택한 필터에 해당하는 데이터가 없습니다.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10">
              <TableRow>
                <TableHead className="w-[180px]">유형</TableHead>
                <TableHead className="w-[100px]">기간 (일)</TableHead>
                <TableHead>서비스 비용</TableHead>
                <TableHead>정부지원금</TableHead>
                <TableHead>본인부담금</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPrices.map((price) => (
                <TableRow key={price.id}>
                  <TableCell className="font-medium">{formatTypeLabel(price.type)}</TableCell>
                  <TableCell>{price.duration}일</TableCell>
                  <TableCell>{formatPrice(price.fullPrice)}</TableCell>
                  <TableCell>{formatPrice(price.grant)}</TableCell>
                  <TableCell>{formatPrice(price.actualPrice)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="shrink-0 mt-3 text-xs text-muted-foreground text-right">
        {isFiltered
          ? `${filteredPrices.length}개 / 총 ${prices.length}개 항목`
          : `총 ${prices.length}개 항목`}
      </div>
      </div>
    </ContentPaper>
  );
}
