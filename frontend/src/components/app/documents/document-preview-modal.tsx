"use client";

import { MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Document, getDownloadUrl } from "@/hooks/use-documents";
import { DocumentCategory } from "@/hooks/use-document-categories";
import { formatFileSize, formatDate } from "./document-list";
import {
  SharedDocumentPreviewDialog,
  type PreviewKind,
  type PreviewMetaItem,
} from "./shared-document-preview-dialog";

interface DocumentPreviewModalProps {
  open: boolean;
  onClose: () => void;
  doc: Document | null;
  categories: DocumentCategory[];
  onEdit?: (doc: Document) => void;
  onDelete?: (doc: Document) => void;
}

function getCategoryLabel(categoryId: string, categories: DocumentCategory[]): string {
  const category = categories.find((item) => item.id === categoryId);
  return category?.label || categoryId;
}

function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  };

  return mimeToExt[mimeType] || "";
}

function getDownloadFileName(doc: Document): string {
  if (doc.name.includes(".")) {
    return doc.name;
  }

  return `${doc.name}${getExtensionFromMimeType(doc.mimeType)}`;
}

function getPreviewKind(mimeType: string): PreviewKind {
  if (mimeType === "application/pdf") {
    return "pdf";
  }

  if (mimeType.startsWith("image/")) {
    return "image";
  }

  return "unsupported";
}

export default function DocumentPreviewModal({
  open,
  onClose,
  doc,
  categories,
  onEdit,
  onDelete,
}: DocumentPreviewModalProps) {
  if (!doc) {
    return null;
  }

  const previewKind = getPreviewKind(doc.mimeType);
  const metaItems: PreviewMetaItem[] = [
    {
      label: "파일 크기",
      value: formatFileSize(doc.fileSize),
    },
    {
      label: "등록일",
      value: formatDate(doc.createdAt),
    },
    {
      label: "파일 포맷",
      value: (
        <span className="uppercase">
          {doc.mimeType.split("/")[1]?.replace("jpeg", "jpg").replace("plain", "txt") || "Unknown"}
        </span>
      ),
    },
  ];

  const metaAction =
    onEdit || onDelete ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {onEdit && <DropdownMenuItem onClick={() => onEdit(doc)}>수정</DropdownMenuItem>}
          {onDelete && (
            <DropdownMenuItem
              onClick={() => {
                onDelete(doc);
                onClose();
              }}
            >
              삭제
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  const metaExtra = (
    <>
      {doc.tags && doc.tags.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-muted-foreground">태그</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {doc.tags.map((tag, index) => (
              <Badge key={`${doc.id}-tag-${index}`} variant="outline" className="text-xs">
                #{tag}
              </Badge>
            ))}
          </div>
        </div>
      )}
      {doc.description && (
        <div className="mt-2">
          <p className="text-xs text-muted-foreground">설명</p>
          <p className="mt-0.5 text-sm">{doc.description}</p>
        </div>
      )}
    </>
  );

  return (
    <SharedDocumentPreviewDialog
      open={open}
      onClose={onClose}
      title={doc.name}
      badges={[
        <Badge variant="outline" key="category">
          {getCategoryLabel(doc.categoryId, categories)}
        </Badge>,
      ]}
      srDescription="문서 메타데이터와 미리보기를 확인하고 확대, 인쇄, 다운로드를 할 수 있습니다."
      metaItems={metaItems}
      metaAction={metaAction}
      metaExtra={metaExtra}
      previewKind={previewKind}
      previewUrl={getDownloadUrl(doc.id)}
      downloadUrl={getDownloadUrl(doc.id, true)}
      downloadFileName={getDownloadFileName(doc)}
      imageAlt={doc.name}
      previewKey={doc.id}
      unsupportedMessage="이 파일 형식은 미리보기를 지원하지 않습니다."
    />
  );
}
