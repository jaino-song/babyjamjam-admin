"use client";

import { useCallback, useState, useEffect } from "react";
import Image from "next/image";
import { useDocumentCategories } from "@/hooks/use-document-categories";
import { CloudUpload, FileText, X, ImageIcon, File, Loader2 } from "lucide-react";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const HANGUL_DOCUMENT_EXTENSIONS = new Set(["hwp", "hwpx"]);
const LABEL_CLASS_NAME =
  "text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-v3-text-muted";
const V3_TEXTAREA_CLASS_NAME =
  "min-h-[104px] rounded-[16px] border-[1.5px] border-v3-border bg-white px-4 py-3 text-[0.85rem] text-v3-dark shadow-none transition-all focus-visible:border-v3-primary focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:shadow-[0_0_0_3px_hsla(214,100%,34%,0.08)]";
const V3_SELECT_TRIGGER_CLASS_NAME =
  "h-12 w-full";
const V3_SELECT_CONTENT_CLASS_NAME =
  "rounded-[22px]";
const V3_SELECT_ITEM_CLASS_NAME = "rounded-[16px]";

interface DocumentDropzoneProps {
  onUpload: (params: {
    file: File;
    name: string;
    description?: string;
    categoryId: string;
    tags: string[];
  }) => Promise<void>;
  isLoading?: boolean;
  uploadProgress?: number;
}

export function DocumentDropzone({
  onUpload,
  isLoading = false,
  uploadProgress = 0,
}: DocumentDropzoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  const locale = useLocale();
  const { data: categories = [] } = useDocumentCategories();

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const validateFile = useCallback((file: File): string | null => {
    if (file.size > MAX_FILE_SIZE) {
      const sizeMB = (file.size / 1024 / 1024).toFixed(2);
      return `파일 크기가 25MB를 초과합니다. 현재 크기: ${sizeMB}MB`;
    }

    return null;
  }, []);

  const handleFile = useCallback(
    (file: File) => {
      const error = validateFile(file);
      if (error) {
        setValidationError(error);
        return;
      }

      setValidationError(null);
      setSelectedFile(file);

      const fileNameWithoutExt =
        file.name.substring(0, file.name.lastIndexOf(".")) || file.name;
      setName(fileNameWithoutExt);

      if (file.type.startsWith("image/")) {
        const url = URL.createObjectURL(file);
        setPreviewUrl(url);
      } else {
        setPreviewUrl(null);
      }
    },
    [validateFile]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isLoading) {
        setIsDragOver(true);
      }
    },
    [isLoading]
  );

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      if (isLoading) return;

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        handleFile(files[0]);
      }
    },
    [handleFile, isLoading]
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        handleFile(files[0]);
      }
    },
    [handleFile]
  );

  const handleRemoveFile = useCallback(() => {
    setSelectedFile(null);
    setValidationError(null);
    setName("");
    setDescription("");
    setCategory("");
    setTags([]);
    setTagInput("");
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  }, [previewUrl]);

  const handleAddTag = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && tagInput.trim()) {
      e.preventDefault();
      if (!tags.includes(tagInput.trim())) {
        setTags([...tags, tagInput.trim()]);
      }
      setTagInput("");
    }
  };

  const handleDeleteTag = (tagToDelete: string) => {
    setTags(tags.filter((tag) => tag !== tagToDelete));
  };

  const handleSubmit = async () => {
    if (!selectedFile || !name || !category) return;

    await onUpload({
      file: selectedFile,
      name,
      description: description || undefined,
      categoryId: category,
      tags,
    });
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  const isSelectedHangulFile = () => {
    const extension = selectedFile?.name.split(".").pop()?.toLowerCase();
    return extension ? HANGUL_DOCUMENT_EXTENSIONS.has(extension) : false;
  };

  const getSelectedFileLabel = () => {
    if (isSelectedHangulFile()) {
      return "한글 문서";
    }

    if (selectedFile?.type === "application/pdf") {
      return "PDF 문서";
    }

    if (selectedFile?.type.startsWith("image/")) {
      return "이미지 파일";
    }

    return "첨부 파일";
  };

  const getSelectedFileTone = () => {
    if (isSelectedHangulFile()) {
      return {
        icon: "bg-v3-primary-light text-v3-primary",
        badge: "border-v3-primary/20 bg-v3-primary-light text-v3-primary",
      };
    }

    if (selectedFile?.type === "application/pdf") {
      return {
        icon: "bg-v3-burgundy-light text-v3-burgundy",
        badge: "border-v3-burgundy/20 bg-v3-burgundy-light text-v3-burgundy",
      };
    }

    if (selectedFile?.type.startsWith("image/")) {
      return {
        icon: "bg-v3-primary-light text-v3-primary",
        badge: "border-v3-primary/20 bg-v3-primary-light text-v3-primary",
      };
    }

    return {
      icon: "bg-v3-dim-white text-v3-text-muted",
      badge: "border-v3-border bg-v3-dim-white text-v3-text-muted",
    };
  };

  const getFileIcon = () => {
    if (isSelectedHangulFile()) {
      return <FileText className="h-10 w-10" />;
    }

    if (selectedFile?.type === "application/pdf") {
      return <FileText className="h-10 w-10" />;
    }
    if (selectedFile?.type.startsWith("image/")) {
      return <ImageIcon className="h-10 w-10" />;
    }
    return <File className="h-10 w-10" />;
  };

  const selectedFileTone = getSelectedFileTone();

  return (
    <div
      data-component="contracts-document-dropzone"
      className="w-full space-y-5"
    >
      {validationError && (
        <Alert
          variant="destructive"
          className="rounded-[18px] border-none bg-v3-burgundy-light px-4 py-3 text-v3-burgundy [&>svg]:text-v3-burgundy"
        >
          <AlertDescription>{validationError}</AlertDescription>
        </Alert>
      )}

      {!selectedFile ? (
        <label
          data-component="contracts-document-dropzone-empty"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "block overflow-hidden rounded-[24px] border-[1.5px] border-dashed px-6 py-8 text-center transition-all duration-200",
            isDragOver
              ? "border-v3-primary bg-white shadow-[0_16px_40px_hsla(214,50%,20%,0.08)]"
              : "border-v3-border bg-white",
            isLoading ? "cursor-wait opacity-70" : "cursor-pointer",
            !isLoading &&
              "hover:border-v3-primary/50 hover:bg-white"
          )}
        >
          <input
            type="file"
            onChange={handleFileInputChange}
            disabled={isLoading}
            className="sr-only"
          />

          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-[0_12px_30px_hsla(214,50%,20%,0.10)]">
            <CloudUpload className="h-8 w-8 text-v3-primary" />
          </div>
          <div className="mt-4">
            <p className="text-[1rem] font-bold tracking-[-0.02em] text-v3-dark">
              파일을 끌어다 놓거나 클릭해 선택하세요
            </p>
            <p className="mt-2 text-[0.8rem] leading-6 text-v3-text-muted">
              PDF, HWP/HWPX, 이미지, 압축 파일 등 다양한 형식을 바로 업로드할 수 있습니다.
            </p>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Badge
              variant="outline"
              className="border-v3-border bg-white/90 px-3 py-1 text-[0.68rem] font-semibold text-v3-text-muted"
            >
              형식 제한 없음
            </Badge>
            <Badge
              variant="outline"
              className="border-v3-border bg-white/90 px-3 py-1 text-[0.68rem] font-semibold text-v3-text-muted"
            >
              최대 25MB
            </Badge>
          </div>
        </label>
      ) : (
        <div className="space-y-5">
          <section className="rounded-[24px] border border-v3-border/70 bg-white p-5">
            <div className="flex items-start gap-4">
              {previewUrl ? (
                <Image
                  src={previewUrl}
                  alt={selectedFile.name}
                  width={88}
                  height={88}
                  unoptimized
                  className="h-[88px] w-[88px] rounded-[18px] border border-v3-border object-cover shadow-sm"
                />
              ) : (
                <div
                  className={cn(
                    "flex h-[88px] w-[88px] items-center justify-center rounded-[18px] border border-v3-border/70",
                    selectedFileTone.icon
                  )}
                >
                  {getFileIcon()}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className={cn(
                      "px-3 py-1 text-[0.68rem] font-semibold",
                      selectedFileTone.badge
                    )}
                  >
                    {getSelectedFileLabel()}
                  </Badge>
                  <span className="text-[0.72rem] font-medium text-v3-text-muted">
                    {formatFileSize(selectedFile.size)}
                  </span>
                </div>
                <p className="mt-3 truncate text-[1rem] font-semibold text-v3-dark">
                  {selectedFile.name}
                </p>
                <p className="mt-1 text-[0.8rem] leading-6 text-v3-text-muted">
                  업로드 전에 문서명, 카테고리, 태그를 정리하면 이후 검색과 관리가 쉬워집니다.
                </p>
              </div>

              <Button
                variant="ghost"
                size="icon"
                onClick={handleRemoveFile}
                disabled={isLoading}
                className="h-10 w-10 shrink-0 rounded-full border border-v3-border bg-white text-v3-text-muted hover:bg-white hover:text-v3-dark"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </section>

          <section className="rounded-[24px] border border-v3-border/70 bg-white p-5">
            <div>
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-v3-primary">
                {t(locale, "documents.upload-details-title")}
              </p>
              <p className="mt-1 text-[0.8rem] text-v3-text-muted">
                문서 제목, 카테고리, 태그, 설명을 입력해 업로드 기준 정보를 함께 저장합니다.
              </p>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="doc-name" className={LABEL_CLASS_NAME}>
                  문서 제목 <span className="ml-1 text-v3-burgundy">*</span>
                </Label>
                <Input
                  id="doc-name"
                  variant="v3"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isLoading}
                />
              </div>

              <div className="space-y-2">
                <Label className={LABEL_CLASS_NAME}>
                  카테고리 <span className="ml-1 text-v3-burgundy">*</span>
                </Label>
                <Select
                  value={category}
                  onValueChange={setCategory}
                  disabled={isLoading}
                >
                  <SelectTrigger className={V3_SELECT_TRIGGER_CLASS_NAME}>
                    <SelectValue placeholder="카테고리 선택" />
                  </SelectTrigger>
                  <SelectContent className={V3_SELECT_CONTENT_CLASS_NAME}>
                    {categories.map((option) => (
                      <SelectItem
                        key={option.id}
                        value={option.id}
                        className={V3_SELECT_ITEM_CLASS_NAME}
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="doc-tags" className={LABEL_CLASS_NAME}>
                  태그
                </Label>
                <Input
                  id="doc-tags"
                  variant="v3"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={handleAddTag}
                  placeholder="태그를 입력하고 Enter를 눌러 추가"
                  disabled={isLoading}
                />
                <p className="text-[0.75rem] leading-5 text-v3-text-muted">
                  검색에 자주 쓰는 키워드를 등록해 두면 문서를 더 빨리 찾을 수 있습니다.
                </p>
                {tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {tags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => !isLoading && handleDeleteTag(tag)}
                        className="inline-flex items-center gap-1 rounded-full border border-v3-primary/20 bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary transition-colors hover:border-v3-primary/40 hover:bg-v3-primary-light/80"
                      >
                        #{tag}
                        <X className="h-3 w-3" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="doc-description" className={LABEL_CLASS_NAME}>
                  설명
                </Label>
                <Textarea
                  id="doc-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  disabled={isLoading}
                  className={V3_TEXTAREA_CLASS_NAME}
                />
              </div>
            </div>

            {isLoading && (
              <div className="mt-5 rounded-[18px] bg-v3-dim-white px-4 py-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[0.8rem] font-semibold text-v3-dark">
                    업로드 중...
                  </span>
                  <span className="text-[0.78rem] font-semibold text-v3-primary">
                    {Math.round(uploadProgress)}%
                  </span>
                </div>
                <Progress
                  value={uploadProgress}
                  className="h-2.5 bg-v3-primary-light/70"
                />
              </div>
            )}

            <Button
              onClick={handleSubmit}
              disabled={!name || !category || isLoading}
              variant="positive"
              size="lg"
              className="mt-5 w-full"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  업로드 중...
                </>
              ) : (
                <>
                  <CloudUpload className="mr-2 h-5 w-5" />
                  문서 업로드
                </>
              )}
            </Button>
          </section>
        </div>
      )}
    </div>
  );
}
