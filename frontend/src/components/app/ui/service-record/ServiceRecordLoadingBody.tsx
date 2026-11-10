import { Skeleton } from "@/components/ui/skeleton";

const LOADING_COPY = "불러오는 중…";

export interface ServiceRecordLoadingBodyProps {
  "data-component": string;
}

/** Placeholder for the next step: title, help, field and action shapes. */
export function ServiceRecordLoadingBody({ "data-component": root }: ServiceRecordLoadingBodyProps) {
  return (
    <div
      data-component={root}
      data-slot="state"
      data-source-component="ServiceRecordLoadingBody"
      role="status"
      aria-label={LOADING_COPY}
      aria-busy="true"
      className="flex min-w-0 flex-1 flex-col px-[calc(16px*var(--glint-ui-scale,1))] pb-[calc(24px*var(--glint-ui-scale,1))] pt-[calc(20px*var(--glint-ui-scale,1))]"
    >
      <span data-component={`${root}_label`} className="sr-only">{LOADING_COPY}</span>
      <Skeleton data-component={`${root}_title`} aria-hidden="true" className="mb-[calc(12px*var(--glint-ui-scale,1))] h-[calc(22px*var(--glint-ui-scale,1))] w-3/5 rounded-[calc(8px*var(--glint-ui-scale,1))] bg-v3-dim-white" />
      <Skeleton data-component={`${root}_help-first`} aria-hidden="true" className="mb-[calc(8px*var(--glint-ui-scale,1))] h-[calc(12px*var(--glint-ui-scale,1))] w-[90%] rounded-[calc(8px*var(--glint-ui-scale,1))] bg-v3-dim-white" />
      <Skeleton data-component={`${root}_help-second`} aria-hidden="true" className="mb-[calc(24px*var(--glint-ui-scale,1))] h-[calc(12px*var(--glint-ui-scale,1))] w-[70%] rounded-[calc(8px*var(--glint-ui-scale,1))] bg-v3-dim-white" />
      <Skeleton data-component={`${root}_field-label`} aria-hidden="true" className="mb-[calc(10px*var(--glint-ui-scale,1))] h-[calc(14px*var(--glint-ui-scale,1))] w-[28%] rounded-[calc(8px*var(--glint-ui-scale,1))] bg-v3-dim-white" />
      <Skeleton data-component={`${root}_field`} aria-hidden="true" className="mb-[calc(16px*var(--glint-ui-scale,1))] h-[calc(50px*var(--glint-ui-scale,1))] w-full rounded-[calc(24px*var(--glint-ui-scale,1))] bg-v3-dim-white" />
      <Skeleton data-component={`${root}_action`} aria-hidden="true" className="h-[calc(46px*var(--glint-ui-scale,1))] w-full rounded-full bg-v3-dim-white" />
    </div>
  );
}
