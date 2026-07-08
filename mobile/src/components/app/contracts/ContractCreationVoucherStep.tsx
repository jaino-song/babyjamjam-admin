"use client";

import { Autocomplete } from "@/components/app/ui/Autocomplete";
import { FormSection } from "@/components/app/ui/form-section";
import { StatusBadge } from "@/components/app/ui/status-badge";
import { Block, InputField } from "@/components/app/v3";
import {
  formatContractCreationPrice,
  parseContractCreationPrice,
  type ContractCreationFlow,
  type ContractCreationOption,
  type ContractCreationVoucherTypeOption,
} from "@/hooks/contracts/useContractCreationFlow";

interface ContractCreationVoucherStepProps {
  flow: ContractCreationFlow;
}

export function ContractCreationVoucherStep({ flow }: ContractCreationVoucherStepProps) {
  const { form, state, actions } = flow;

  return (
    <Block name="contracts-new-voucher-step" className="space-y-4">
      <FormSection title="바우처 선택" data-component="contracts-new-voucher-selection-section">
        <Block name="contracts-new-voucher-selection-grid" className="grid grid-cols-2 gap-2.5">
          <Autocomplete<ContractCreationOption<number>>
            name="contracts-new-voucher-year"
            value={flow.selectedVoucherYearOption}
            onChange={actions.changeVoucherYear}
            items={flow.voucherYearOptions}
            getItemKey={(option) => option.value}
            getItemLabel={(option) => option.label}
            placeholder="연도 선택"
            label="연도"
            required
          />
          <Autocomplete<ContractCreationVoucherTypeOption>
            name="contracts-new-voucher-type"
            value={flow.selectedVoucherTypeOption}
            onChange={actions.changeVoucherType}
            items={flow.voucherTypeOptions}
            getItemKey={(option) => option.value}
            getItemLabel={(option) => option.label}
            getItemMeta={(option) => option.group}
            placeholder="바우처 유형 선택"
            label="바우처 유형"
            required
          />
        </Block>
        <Autocomplete<ContractCreationOption>
          name="contracts-new-voucher-duration"
          value={flow.selectedDurationOption}
          onChange={actions.changeDuration}
          items={flow.durationOptions}
          getItemKey={(option) => option.value}
          getItemLabel={(option) => option.label}
          placeholder={state.isPriceLoading ? "기간 불러오는 중" : "기간 선택"}
          label="기간"
          required
          disabled={!form.voucherType || state.isPriceLoading}
          emptyMessage="선택 가능한 기간이 없습니다."
        />
      </FormSection>

      <FormSection
        title="요금 정보"
        badge={flow.selectedPriceInfo && !state.pricesManuallyEdited ? <StatusBadge variant="success">자동입력</StatusBadge> : undefined}
        data-component="contracts-new-voucher-price-section"
      >
        <InputField
          title="총 서비스 금액"
          inputProps={{
            id: "contracts-new-voucher-full-price",
            value: formatContractCreationPrice(form.fullPrice),
            onChange: (event) => actions.changePrice("fullPrice", parseContractCreationPrice(event.target.value)),
            inputMode: "numeric",
            placeholder: "0",
            required: true,
          }}
        />
        <InputField
          title="정부지원금"
          inputProps={{
            id: "contracts-new-voucher-grant",
            value: formatContractCreationPrice(form.grant),
            onChange: (event) => actions.changePrice("grant", parseContractCreationPrice(event.target.value)),
            inputMode: "numeric",
            placeholder: "0",
            required: true,
          }}
        />
        <InputField
          title="본인부담금"
          inputProps={{
            id: "contracts-new-voucher-actual-price",
            value: formatContractCreationPrice(form.actualPrice),
            onChange: (event) => actions.changePrice("actualPrice", parseContractCreationPrice(event.target.value)),
            inputMode: "numeric",
            placeholder: "0",
            required: true,
          }}
        />
      </FormSection>
    </Block>
  );
}
