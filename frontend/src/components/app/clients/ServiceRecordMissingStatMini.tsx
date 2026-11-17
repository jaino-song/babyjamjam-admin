"use client";

import { ClipboardX } from "lucide-react";
import { useRef, useState } from "react";
import { StatMini, type StatMiniDensity } from "@/components/app/v3/StatMini";
import { useServiceRecordMissingClients } from "@/features/clients/hooks/use-clients";
import { ServiceRecordMissingModal } from "./ServiceRecordMissingModal";

interface ServiceRecordMissingStatMiniProps {
  name: string;
  density?: StatMiniDensity;
  onSelectClient: (clientId: number) => boolean;
}

export function ServiceRecordMissingStatMini({ name, density, onSelectClient }: ServiceRecordMissingStatMiniProps) {
  const { data, error, refetch } = useServiceRecordMissingClients();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | HTMLDivElement>(null);
  if (data === undefined || (data.count === 0 && !open)) return null;
  const base = `${name}_stats_service-record-missing`;
  return <>
    <StatMini ref={anchorRef} data-component={`${base}_trigger`} interactive icon={ClipboardX}
      value={data.count} counter="명" label="기록지 미작성" colorIndex={3} density={density}
      aria-label="제공기록지 미작성 고객 보기" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} />
    <ServiceRecordMissingModal open={open} onClose={() => setOpen(false)} anchorRef={anchorRef}
      items={data.items} error={error} onRetry={() => void refetch()} data-component={`${base}-modal`}
      onSelectClient={clientId => { if (onSelectClient(clientId)) setOpen(false); }} />
  </>;
}
