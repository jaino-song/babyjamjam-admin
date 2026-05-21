"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useClient, useDeleteClient } from "@/hooks/useClients";
import { useInfiniteClients } from "@/hooks/useInfiniteClients";
import { Client, SERVICE_STATUS_OPTIONS } from "@/lib/client/types";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { toast } from "@/hooks/use-toast";
import { ClientFormDialog } from "@/components/app/clients/ClientFormDialog";
import { ClientDetailModal } from "@/components/app/clients/ClientDetailModal";
import { ConfirmActionModal } from "@/components/app/ui/ConfirmActionModal";
import { matchesKoreanSearch } from "@/lib/search/korean-search";
import { ClientsRedesign } from "@/components/app/mobile-redesign/ClientsRedesign";
import type {
  ClientsRedesignFilter,
} from "@/components/app/mobile-redesign/ClientsRedesign";
import type {
  ListRow,
  SectionRows,
} from "@/components/app/mobile-redesign/mockup-data";

const AVATAR_TONES: NonNullable<ListRow["avatarTone"]>[] = [
  "primary",
  "green",
  "burgundy",
  "orange",
  "purple",
];

function pickAvatarTone(name: string, fallback: number): NonNullable<ListRow["avatarTone"]> {
  const code = name.charCodeAt(0) || fallback;
  return AVATAR_TONES[code % AVATAR_TONES.length];
}

function clientInitial(name: string) {
  return name.trim().charAt(0) || "?";
}

function clientMeta(c: Client) {
  const type = c.type ?? "유형 미정";
  return c.primaryEmployee?.name
    ? `${type} · ${c.primaryEmployee.name}`
    : `${type} · 제공인력 미배정`;
}

function statusLabel(status: string | null) {
  const opt = SERVICE_STATUS_OPTIONS.find((o) => o.value === status);
  return opt?.label ?? "-";
}

interface ClientGroup {
  key: string;
  title: string;
  badge: string;
  badgeTone: ListRow["badgeTone"];
  match: (c: Client) => boolean;
  counter: string;
}

const GROUPS: ClientGroup[] = [
  {
    key: "replacement_requested",
    title: "교체 요청",
    badge: "교체 요청",
    badgeTone: "burgundy",
    match: (c) => c.serviceStatus === "replacement_requested",
    counter: "건",
  },
  {
    key: "active",
    title: "진행중",
    badge: "진행중",
    badgeTone: "primary",
    match: (c) => c.serviceStatus === "active",
    counter: "명",
  },
  {
    key: "waiting",
    title: "대기",
    badge: "대기",
    badgeTone: "muted",
    match: (c) => c.serviceStatus === "waiting" || c.serviceStatus === "pending",
    counter: "명",
  },
  {
    key: "completed",
    title: "완료",
    badge: "완료",
    badgeTone: "green",
    match: (c) => c.serviceStatus === "completed",
    counter: "명",
  },
  {
    key: "expired",
    title: "종료",
    badge: "종료",
    badgeTone: "muted",
    match: (c) => c.serviceStatus === "terminated" || c.serviceStatus === "cancelled",
    counter: "명",
  },
];

export default function ClientsPage() {
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const clientIdParam = searchParams.get("id");

  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deleteTargetClientId, setDeleteTargetClientId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const { allClients, total } = useInfiniteClients({
    filter: "all",
    search: searchQuery,
    filterFn: () => true,
    searchFn: (c, query) => matchesKoreanSearch(c.name, query),
  });

  const deleteClient = useDeleteClient();
  const { data: clientFromParam } = useClient(clientIdParam ? Number(clientIdParam) : 0);

  useEffect(() => {
    if (clientIdParam && clientFromParam) {
      setSelectedClient(clientFromParam);
      setDetailModalOpen(true);
    }
  }, [clientIdParam, clientFromParam]);

  const handleSelectClient = (client: Client) => {
    setSelectedClient(client);
    setDetailModalOpen(true);
  };

  const handleDetailModalClose = () => {
    setDetailModalOpen(false);
    if (clientIdParam) {
      router.replace("/clients");
    }
  };

  const handleEdit = (client: Client) => {
    setEditingClient(client);
    setFormDialogOpen(true);
    setDetailModalOpen(false);
  };

  const handleDeleteRequest = (id: number) => {
    setDeleteTargetClientId(id);
  };

  const handleDeleteConfirm = async () => {
    if (deleteTargetClientId == null) return;
    try {
      await deleteClient.mutateAsync(deleteTargetClientId);
      if (selectedClient?.id === deleteTargetClientId) {
        setSelectedClient(null);
        setDetailModalOpen(false);
      }
      setDeleteTargetClientId(null);
      toast({
        title: t(locale, "clients.delete-success"),
        description: t(locale, "clients.delete-success-description"),
      });
    } catch {
      toast({
        title: t(locale, "clients.delete-fail"),
        description: t(locale, "clients.delete-fail-description"),
        variant: "destructive",
      });
    }
  };

  const { sections, filters } = useMemo(() => {
    const baseSections: SectionRows[] = [];
    const counts: Record<string, number> = {};
    let i = 0;

    for (const group of GROUPS) {
      const matched = allClients.filter(group.match);
      counts[group.key] = matched.length;
      if (matched.length === 0) continue;
      const rows: ListRow[] = matched.map((c) => {
        const row: ListRow = {
          id: c.id,
          name: c.name,
          meta: clientMeta(c),
          initial: clientInitial(c.name),
          badge: group.badge,
          badgeTone: group.badgeTone,
          avatarTone: pickAvatarTone(c.name, i++),
          onClick: () => handleSelectClient(c),
        };
        return row;
      });
      baseSections.push({
        title: `${group.title} · ${matched.length}${group.counter}`,
        rows,
      });
    }

    const filterPills: ClientsRedesignFilter[] = [
      { label: "전체", count: String(allClients.length), active: true },
      ...GROUPS.filter((g) => counts[g.key] > 0).map((g) => ({
        label: g.title,
        count: String(counts[g.key]),
      })),
    ];

    return { sections: baseSections, filters: filterPills };
    // handleSelectClient is stable enough; intentionally exclude to avoid re-keying rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allClients]);

  return (
    <>
      <ClientsRedesign
        sections={sections}
        filters={filters}
        total={total ?? allClients.length}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        actionHref="/clients/new"
      />

      <ClientDetailModal
        open={detailModalOpen}
        onClose={handleDetailModalClose}
        client={selectedClient}
        onEdit={handleEdit}
        onDelete={handleDeleteRequest}
      />

      <ConfirmActionModal
        open={deleteTargetClientId != null}
        title={t(locale, "common.delete")}
        description={t(locale, "clients.delete-confirm")}
        cancelLabel={t(locale, "common.cancel")}
        confirmLabel={t(locale, "common.delete")}
        loading={deleteClient.isPending}
        onOpenChange={(open) => {
          if (!open && !deleteClient.isPending) {
            setDeleteTargetClientId(null);
          }
        }}
        onCancel={() => setDeleteTargetClientId(null)}
        onConfirm={handleDeleteConfirm}
      />

      <ClientFormDialog
        open={formDialogOpen}
        onClose={() => {
          setFormDialogOpen(false);
          setEditingClient(null);
        }}
        client={editingClient}
      />
    </>
  );
}
