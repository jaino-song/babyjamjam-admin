"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Send, Users } from "lucide-react";

import { ContentPaper } from "@/components/app/root/content-paper";
import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  notificationSendApi,
  type BroadcastNotificationResult,
  type NotificationRecipient,
} from "@/services/api";

const SOURCE_COMPONENT = "SendNotificationSection";
const DATA_COMPONENT = "desktop_settings_sections_send-notification";

// Limits enforced by the backend DTOs (SendNotificationDto / BroadcastNotificationDto).
export const NOTIFICATION_TITLE_MAX_LENGTH = 100;
export const NOTIFICATION_BODY_MAX_LENGTH = 500;

type RecipientMode = "branch" | "one";

interface SendNotificationSectionProps {
  branchId: string;
}

function recipientsQueryKey(branchId: string) {
  return ["settings", "notification-recipients", branchId] as const;
}

export function SendNotificationSection({ branchId }: SendNotificationSectionProps) {
  const { toast } = useToast();
  const [mode, setMode] = useState<RecipientMode>("branch");
  const [recipientId, setRecipientId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const recipientsQuery = useQuery({
    queryKey: recipientsQueryKey(branchId),
    queryFn: notificationSendApi.listRecipients,
  });
  const recipients: NotificationRecipient[] = recipientsQuery.data ?? [];
  const selectedRecipient = recipients.find((recipient) => recipient.id === recipientId);

  const clearDraft = () => {
    setTitle("");
    setBody("");
    setRecipientId("");
  };

  const sendMutation = useMutation({
    mutationFn: async (): Promise<BroadcastNotificationResult> => {
      const message = { title: title.trim(), body: body.trim() };
      if (mode === "one") {
        await notificationSendApi.send(recipientId, message);
        return { sent: 1, failed: 0 };
      }
      return notificationSendApi.broadcast(message);
    },
    onSuccess: (result) => {
      setIsConfirmOpen(false);
      if (result.failed > 0) {
        // Keep the draft: the manager decides whether to resend. No automatic
        // retry — resending a broadcast would duplicate it for everyone it reached.
        toast({
          variant: "destructive",
          description: `${result.sent}명에게 알림을 만들었고 ${result.failed}명은 실패했어요`,
        });
        return;
      }
      toast({
        variant: "success",
        description:
          mode === "one"
            ? `${selectedRecipient?.name ?? "직원"}님에게 알림을 보냈어요`
            : `${result.sent}명에게 알림을 보냈어요`,
      });
      clearDraft();
    },
    onError: () => {
      setIsConfirmOpen(false);
      toast({ variant: "destructive", description: "알림을 보내지 못했어요" });
    },
  });

  const hasRecipients = recipients.length > 0;
  const canSend =
    hasRecipients
    && title.trim().length > 0
    && body.trim().length > 0
    && (mode === "branch" || Boolean(selectedRecipient))
    && !sendMutation.isPending;

  const confirmDescription =
    mode === "one"
      ? `${selectedRecipient?.name ?? ""}님에게 "${title.trim()}" 알림을 보냅니다.`
      : `지점 전체 ${recipients.length}명에게 "${title.trim()}" 알림을 보냅니다.`;

  return (
    <section data-component={DATA_COMPONENT} data-source-component={SOURCE_COMPONENT}>
      <ContentPaper variant="v3">
        <div data-component={`${DATA_COMPONENT}_header`} className="mb-4 flex items-center gap-3">
          <div
            data-component={`${DATA_COMPONENT}_header_icon`}
            className="flex items-center justify-center w-10 h-10 rounded-xl bg-[hsl(var(--v3-primary))]/10"
          >
            <Send size={20} className="text-[hsl(var(--v3-primary))]" />
          </div>
          <div data-component={`${DATA_COMPONENT}_header_title-group`} className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-foreground">알림 보내기</h2>
            <p className="text-sm text-muted-foreground">
              지점 직원에게 앱 알림을 보냅니다. 알림함, 푸시, 이메일(설정한 직원)로 전달됩니다.
            </p>
          </div>
        </div>
        <Separator className="mb-6" />

        {recipientsQuery.isLoading ? (
          <div data-component={`${DATA_COMPONENT}_skeleton`} className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : recipientsQuery.isError ? (
          <p
            role="alert"
            data-component={`${DATA_COMPONENT}_error`}
            className="text-sm font-medium text-red-700"
          >
            받는 사람 목록을 불러오지 못했습니다.
          </p>
        ) : !hasRecipients ? (
          <div
            data-component={`${DATA_COMPONENT}_empty`}
            className="flex flex-col items-center justify-center py-12 text-muted-foreground"
          >
            <Users size={40} className="mb-3 opacity-30" />
            <p className="text-sm">이 지점에는 알림을 받을 직원이 없습니다.</p>
          </div>
        ) : (
          <form
            data-component={`${DATA_COMPONENT}_form`}
            className="space-y-6"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSend) setIsConfirmOpen(true);
            }}
          >
            <div data-component={`${DATA_COMPONENT}_form_recipient`} className="space-y-3">
              <Label>받는 사람</Label>
              <RadioGroup
                value={mode}
                onValueChange={(value) => setMode(value as RecipientMode)}
                className="flex gap-6"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem id="send-notification-mode-branch" value="branch" />
                  <Label htmlFor="send-notification-mode-branch" className="font-normal">
                    지점 전체 ({recipients.length}명)
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem id="send-notification-mode-one" value="one" />
                  <Label htmlFor="send-notification-mode-one" className="font-normal">
                    직원 1명
                  </Label>
                </div>
              </RadioGroup>
              {mode === "one" ? (
                <Select value={recipientId} onValueChange={setRecipientId}>
                  <SelectTrigger
                    data-component={`${DATA_COMPONENT}_form_recipient_select`}
                    className="max-w-sm"
                    aria-label="받는 직원"
                  >
                    <SelectValue placeholder="직원을 선택하세요" />
                  </SelectTrigger>
                  <SelectContent>
                    {recipients.map((recipient) => (
                      <SelectItem key={recipient.id} value={recipient.id}>
                        {recipient.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>

            <div data-component={`${DATA_COMPONENT}_form_title`} className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="send-notification-title">제목</Label>
                <span className="text-xs text-muted-foreground">
                  {title.length}/{NOTIFICATION_TITLE_MAX_LENGTH}
                </span>
              </div>
              <Input
                id="send-notification-title"
                value={title}
                maxLength={NOTIFICATION_TITLE_MAX_LENGTH}
                placeholder="예: 내일 오전 회의 안내"
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>

            <div data-component={`${DATA_COMPONENT}_form_body`} className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="send-notification-body">내용</Label>
                <span className="text-xs text-muted-foreground">
                  {body.length}/{NOTIFICATION_BODY_MAX_LENGTH}
                </span>
              </div>
              <Textarea
                id="send-notification-body"
                value={body}
                rows={5}
                maxLength={NOTIFICATION_BODY_MAX_LENGTH}
                placeholder="직원에게 전달할 내용을 입력하세요"
                onChange={(event) => setBody(event.target.value)}
              />
            </div>

            <div data-component={`${DATA_COMPONENT}_form_actions`} className="flex justify-end">
              <Button
                type="submit"
                variant="positive"
                data-component={`${DATA_COMPONENT}_form_actions_submit`}
                disabled={!canSend}
              >
                <Send className="h-4 w-4" />
                보내기
              </Button>
            </div>
          </form>
        )}
      </ContentPaper>

      <TwoButtonModal
        open={isConfirmOpen}
        onOpenChange={setIsConfirmOpen}
        dataComponent={`${DATA_COMPONENT}_confirm`}
        title="알림을 보낼까요?"
        description={confirmDescription}
        isDescriptionVisuallyHidden={false}
        cancelLabel="닫기"
        approvalLabel="보내기"
        pendingLabel="보내는 중..."
        isPending={sendMutation.isPending}
        onApprove={() => sendMutation.mutate()}
      />
    </section>
  );
}
