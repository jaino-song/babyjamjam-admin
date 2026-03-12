"use client";

import { Badge } from "@/components/ui/badge";
import type { EformsignDocument } from "@/lib/eformsign/types";
import {
  SharedDocumentPreviewDialog,
  type PreviewMetaItem,
} from "@/components/app/documents/shared-document-preview-dialog";

interface ContractDocumentPreviewModalProps {
  open: boolean;
  onClose: () => void;
  document: EformsignDocument | null;
  customerName?: string | null;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function getPreviewUrl(documentId: string, attachment = false): string {
  const base = `/api/eformsign/documents/${documentId}/preview`;
  return attachment ? `${base}?attachment=true` : base;
}

export function ContractDocumentPreviewModal({
  open,
  onClose,
  document,
  customerName,
}: ContractDocumentPreviewModalProps) {
  if (!document) {
    return null;
  }

  const metaItems: PreviewMetaItem[] = [
    {
      label: "고객",
      value: customerName ?? "-",
    },
    {
      label: "작성일",
      value: formatDate(document.created_date),
    },
    {
      label: "문서번호",
      value: document.document_number ?? "-",
    },
    {
      label: "파일 포맷",
      value: <span className="uppercase">PDF</span>,
    },
    {
      label: "문서 ID",
      value: <span className="break-all font-mono">{document.id}</span>,
      className: "min-w-[16rem] flex-1",
    },
  ];

  return (
    <SharedDocumentPreviewDialog
      open={open}
      onClose={onClose}
      title={document.document_name}
      badges={[
        <Badge variant="outline" key="template">
          {document.template?.name ?? "전자문서 계약서"}
        </Badge>,
      ]}
      srDescription="전자문서 메타데이터와 미리보기를 확인하고 확대, 인쇄, 다운로드를 할 수 있습니다."
      metaItems={metaItems}
      previewKind="pdf"
      previewUrl={getPreviewUrl(document.id)}
      downloadUrl={getPreviewUrl(document.id, true)}
      downloadFileName={`${document.document_name || document.id}.pdf`}
      overlayLabel="PDF 미리보기"
      previewKey={document.id}
    />
  );
}
