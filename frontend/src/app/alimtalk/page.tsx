"use client";

import { type ChangeEvent, useCallback, useMemo, useState } from "react";
import Image from "next/image";
import {
  Battery,
  CircleHelp,
  ChevronLeft,
  ExternalLink,
  FilePen,
  FileText,
  History,
  MessageCircle,
  Plus,
  Send,
  Settings,
  Signal,
  Trash2,
  Wifi,
  Workflow,
} from "lucide-react";
import { ContentPaper } from "@/components/app/root/content-paper";
import {
  DetailPanel,
  DetailTabs,
  HeaderActionButton,
  ListEmptyState,
  ListPanel,
  SectionNav,
  SplitLayout,
} from "@/components/app/v3";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TriggerRulesManager } from "@/components/app/alimtalk/TriggerRulesManager";
import { AlimtalkHistoryManager } from "@/components/app/alimtalk/AlimtalkHistoryManager";
import { UpcomingAlimtalkManager } from "@/components/app/alimtalk/UpcomingAlimtalkManager";
import { AlimtalkTenantApplicationSettings } from "@/components/app/alimtalk/AlimtalkTenantApplicationSettings";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const NAV_SECTIONS = [
  { id: "overview", label: "발송 예정", icon: Send },
  { id: "history", label: "발송 기록", icon: History },
  { id: "templates", label: "템플릿", icon: FileText },
  { id: "triggers", label: "발송 트리거 설정", icon: Workflow },
  { id: "settings", label: "설정", icon: Settings },
] as const;

type SectionId = (typeof NAV_SECTIONS)[number]["id"];

type TplType = "BA" | "EX" | "AD" | "MI";
type TplEmType = "NONE" | "TEXT" | "IMAGE";
type ButtonLinkType = "WL" | "AL" | "BK" | "MD" | "DS" | "AC";
type TemplateGroup = "builtin" | "custom";
type TemplateMode = "browse" | "create";
type TemplateDetailTab = "details" | "preview";
type TemplateStatus = "승인완료" | "심사중";

interface TemplateButton {
  name: string;
  linkType: ButtonLinkType;
  linkM: string;
  linkP: string;
  linkI: string;
  linkA: string;
}

interface TemplateRecord {
  id: string;
  name: string;
  description: string;
  group: TemplateGroup;
  tplType: TplType;
  tplEmType: TplEmType;
  title?: string;
  subtitle?: string;
  content: string;
  extra?: string;
  advert?: string;
  imagePreviewUrl?: string;
  buttons: TemplateButton[];
  updatedAt: string;
  status: TemplateStatus;
  provider: string;
}

interface TemplateImageState {
  file: File;
  fileName: string;
  mimeType: string;
  size: number;
  previewUrl: string;
}

interface TemplateSubmitPayload {
  name: string;
  tplType: TplType;
  tplEmType: TplEmType;
  title?: string;
  subtitle?: string;
  content: string;
  extra?: string;
  advert?: string;
  imagePreviewUrl?: string;
  buttons: TemplateButton[];
}

interface GuideExampleSection {
  id: string;
  label: string;
  title: string;
  summary: string;
  bullets: string[];
  imageUrl?: string;
  imageAlt?: string;
  note?: string;
  exampleTitle?: string;
  exampleMessage?: string;
  exampleCaption?: string;
}

const KAKAO_TEMPLATE_GUIDE_URL =
  "https://kakaobusiness.gitbook.io/main/ad/bizmessage/notice-friend/content-guide";

const KAKAO_GUIDE_IMAGES = {
  messageBasic:
    "https://kakaobusiness.gitbook.io/main/~gitbook/image?url=https%3A%2F%2F234308570-files.gitbook.io%2F%7E%2Ffiles%2Fv0%2Fb%2Fgitbook-x-prod.appspot.com%2Fo%2Fspaces%252F-MVZVmVOd-5LtENUPqdq%252Fuploads%252FMMG4z17ptcBwbqqW9rRc%252F1%25E1%2584%2586%25E1%2585%25A6%25E1%2584%2589%25E1%2585%25B5%25E1%2584%258C%25E1%2585%25B5%25E1%2584%258B%25E1%2585%25B2%25E1%2584%2592%25E1%2585%25A7%25E1%2586%25BC_1%25E1%2584%2580%25E1%2585%25B5%25E1%2584%2587%25E1%2585%25A9%25E1%2586%25AB%25E1%2584%2592%25E1%2585%25A7%25E1%2586%25BC.png%3Falt%3Dmedia%26token%3D06798481-052b-46fd-827a-f7e509c0bdac&width=768&dpr=2&quality=100&sign=ffb3a796&sv=2",
  messageExtra:
    "https://kakaobusiness.gitbook.io/main/~gitbook/image?url=https%3A%2F%2F234308570-files.gitbook.io%2F%7E%2Ffiles%2Fv0%2Fb%2Fgitbook-x-prod.appspot.com%2Fo%2Fspaces%252F-MVZVmVOd-5LtENUPqdq%252Fuploads%252FF1NwLauNo1M7DOhCBXxS%252F1%25E1%2584%2586%25E1%2585%25A6%25E1%2584%2589%25E1%2585%25B5%25E1%2584%258C%25E1%2585%25B5%25E1%2584%258B%25E1%2585%25B2%25E1%2584%2592%25E1%2585%25A7%25E1%2586%25BC_2%25E1%2584%2587%25E1%2585%25AE%25E1%2584%2580%25E1%2585%25A1%25E1%2584%258C%25E1%2585%25A5%25E1%2586%25BC%25E1%2584%2587%25E1%2585%25A9%25E1%2584%2592%25E1%2585%25A7%25E1%2586%25BC.png%3Falt%3Dmedia%26token%3D3cc7ff01-a442-4e6e-a28a-7a31fee1d372&width=768&dpr=2&quality=100&sign=1c8d65ef&sv=2",
  messageChannel:
    "https://kakaobusiness.gitbook.io/main/~gitbook/image?url=https%3A%2F%2F234308570-files.gitbook.io%2F%7E%2Ffiles%2Fv0%2Fb%2Fgitbook-x-prod.appspot.com%2Fo%2Fspaces%252F-MVZVmVOd-5LtENUPqdq%252Fuploads%252FHvBhmDbQZ8EfHYjgd0E7%252F1%25E1%2584%2586%25E1%2585%25A6%25E1%2584%2589%25E1%2585%25B5%25E1%2584%258C%25E1%2585%25B5%25E1%2584%258B%25E1%2585%25B2%25E1%2584%2592%25E1%2585%25A7%25E1%2586%25BC_3%25E1%2584%258E%25E1%2585%25A2%25E1%2584%2582%25E1%2585%25A5%25E1%2586%25AF%25E1%2584%258E%25E1%2585%25AE%25E1%2584%2580%25E1%2585%25A1%25E1%2584%2592%25E1%2585%25A7%25E1%2586%25BC.png%3Falt%3Dmedia%26token%3De81f2b88-cfed-4e06-af01-a1557b37bea5&width=768&dpr=2&quality=100&sign=d07478cc&sv=2",
  messageMixed:
    "https://kakaobusiness.gitbook.io/main/~gitbook/image?url=https%3A%2F%2F234308570-files.gitbook.io%2F%7E%2Ffiles%2Fv0%2Fb%2Fgitbook-x-prod.appspot.com%2Fo%2Fspaces%252F-MVZVmVOd-5LtENUPqdq%252Fuploads%252FPSotrsCOmNPkltHE1TQp%252F1%25E1%2584%2586%25E1%2585%25A6%25E1%2584%2589%25E1%2585%25B5%25E1%2584%258C%25E1%2585%25B5%25E1%2584%258B%25E1%2585%25B2%25E1%2584%2592%25E1%2585%25A7%25E1%2586%25BC_4%25E1%2584%2587%25E1%2585%25A9%25E1%2586%25A8%25E1%2584%2592%25E1%2585%25A1%25E1%2586%25B8%25E1%2584%2592%25E1%2585%25A7%25E1%2586%25BC.png%3Falt%3Dmedia%26token%3D29213843-8f4e-4090-b1cb-5d72d2ea07df&width=768&dpr=2&quality=100&sign=2b61ec0c&sv=2",
  emphasisImage:
    "https://kakaobusiness.gitbook.io/main/~gitbook/image?url=https%3A%2F%2F234308570-files.gitbook.io%2F%7E%2Ffiles%2Fv0%2Fb%2Fgitbook-x-prod.appspot.com%2Fo%2Fspaces%252F-MVZVmVOd-5LtENUPqdq%252Fuploads%252Fi4pmGDd3LQqV8x7B2WPP%252F2%25E1%2584%2580%25E1%2585%25A1%25E1%2586%25BC%25E1%2584%258C%25E1%2585%25A9%25E1%2584%258B%25E1%2585%25B2%25E1%2584%2592%25E1%2585%25A7%25E1%2586%25BC_1%25E1%2584%258B%25E1%2585%25B5%25E1%2584%2586%25E1%2585%25B5%25E1%2584%258C%25E1%2585%25B5%25E1%2584%2592%25E1%2585%25A7%25E1%2586%25BC.png%3Falt%3Dmedia%26token%3Dfe1795a8-35c6-4d9a-98ee-7eaff8245df5&width=768&dpr=2&quality=100&sign=3f7a9ac9&sv=2",
  emphasisText:
    "https://kakaobusiness.gitbook.io/main/~gitbook/image?url=https%3A%2F%2F234308570-files.gitbook.io%2F%7E%2Ffiles%2Fv0%2Fb%2Fgitbook-x-prod.appspot.com%2Fo%2Fspaces%252F-MVZVmVOd-5LtENUPqdq%252Fuploads%252FWJKxzVJs2Iejo9pLYqri%252F2%25E1%2584%2580%25E1%2585%25A1%25E1%2586%25BC%25E1%2584%258C%25E1%2585%25A9%25E1%2584%258B%25E1%2585%25B2%25E1%2584%2592%25E1%2585%25A7%25E1%2586%25BC_2%25E1%2584%2580%25E1%2585%25A1%25E1%2586%25BC%25E1%2584%258C%25E1%2585%25A9%25E1%2584%2591%25E1%2585%25AD%25E1%2584%2580%25E1%2585%25B5%25E1%2584%2592%25E1%2585%25A7%25E1%2586%25BC.png%3Falt%3Dmedia%26token%3D5685ee7f-ba16-4e9a-86ef-4aeeb71efda0&width=768&dpr=2&quality=100&sign=6cd74c0b&sv=2",
} as const;

const MESSAGE_TYPE_GUIDE_SECTIONS: GuideExampleSection[] = [
  {
    id: "basic",
    label: "기본형",
    title: "기본형 메시지 예시",
    summary:
      "카카오 공식 가이드에서는 기본형을 주문, 예약, 일정, 인증처럼 수신자에게 반드시 전달해야 하는 핵심 안내를 보내는 표준 알림톡으로 설명합니다.",
    bullets: [
      "본문이 메시지의 중심이고 별도의 부가 정보 영역 없이 바로 노출됩니다.",
      "정보 전달이 목적일 때 가장 일반적으로 사용하는 유형입니다.",
      "현재 작성 화면에서는 부가 정보를 비워 두면 기본형으로 등록됩니다.",
    ],
    imageUrl: KAKAO_GUIDE_IMAGES.messageBasic,
    imageAlt: "카카오 알림톡 기본형 공식 예시",
    note: "공식 이미지 예시는 카카오 비즈니스 가이드의 기본형 샘플입니다.",
    exampleTitle: "기본형 예시 메시지",
    exampleMessage:
      "[아가잼잼]\n#{고객명}님, 서비스 예약이 완료되었습니다.\n\n• 예약 일시: #{예약일시}\n• 담당 매니저: #{담당자명}\n• 방문 주소: #{방문주소}\n\n변경이 필요하시면 고객센터로 연락해 주세요.",
    exampleCaption: "예약 완료, 접수 안내, 인증 완료처럼 핵심 정보만 명확히 전달할 때 쓰는 기본형 예시입니다.",
  },
  {
    id: "extra",
    label: "부가정보형",
    title: "부가정보형 메시지 예시",
    summary:
      "부가정보형은 이용안내 같은 고정적인 보조 정보를 본문 하단에 반복적으로 안내할 때 쓰는 유형으로, 카카오 공식 가이드에서도 별도 하단 영역 노출을 기준으로 설명합니다.",
    bullets: [
      "본문과 구분된 하단 부가 정보 영역이 추가됩니다.",
      "정기 안내나 이용안내처럼 반복되는 고정 문구에 적합합니다.",
      "현재 작성 화면의 부가 정보 입력란이 이 공식 유형에 대응됩니다.",
    ],
    imageUrl: KAKAO_GUIDE_IMAGES.messageExtra,
    imageAlt: "카카오 알림톡 부가정보형 공식 예시",
    note: "광고 요소와 함께 쓰는 경우에는 카카오 가이드의 광고성 제한과 버튼 규칙을 함께 확인해야 합니다.",
    exampleTitle: "부가정보형 예시 메시지",
    exampleMessage:
      "[아가잼잼]\n#{고객명}님, 다음 방문 일정이 확정되었습니다.\n\n• 방문 일시: #{방문일시}\n• 담당자: #{담당자명}\n\n[부가 정보]\n방문 전 준비물: 신분증, 서비스 신청서, 산모수첩",
    exampleCaption: "본문 아래 고정 안내를 반복 노출해야 할 때 부가 정보형을 사용합니다.",
  },
  {
    id: "channel",
    label: "채널추가형",
    title: "채널추가형 메시지 예시",
    summary:
      "채널추가형은 비광고성 메시지 하단에 카카오톡 채널 추가 영역이 함께 붙는 유형입니다. 공식 가이드에서는 고정 문구와 함께 채널 추가 영역이 노출되는 구조를 예시로 안내합니다.",
    bullets: [
      "본문은 정보성 메시지여야 하고 하단에 채널 추가 영역이 붙습니다.",
      "채널 추가 문구는 카카오 정책에 따라 정해진 문안만 사용할 수 있습니다.",
      "향후 채널 추가 옵션을 붙일 때 참고할 수 있는 공식 구조입니다.",
    ],
    imageUrl: KAKAO_GUIDE_IMAGES.messageChannel,
    imageAlt: "카카오 알림톡 채널추가형 공식 예시",
    note: "현재 작성 폼은 채널추가형 자체를 직접 등록하지 않지만, 카카오 공식 유형 예시는 여기서 확인할 수 있습니다.",
    exampleTitle: "채널추가형 예시 메시지",
    exampleMessage:
      "[아가잼잼]\n#{고객명}님, 서비스 이용 안내를 보내드립니다.\n\n• 이용 시작일: #{시작일}\n• 담당자: #{담당자명}\n\n+ 채널 추가하고 이 채널의 마케팅 메시지 등을 카카오톡으로 받기",
    exampleCaption: "하단 채널 추가 영역은 카카오 정책 문구를 그대로 사용해야 합니다.",
  },
  {
    id: "mix",
    label: "복합형",
    title: "복합형 메시지 예시",
    summary:
      "복합형은 부가정보형과 채널추가형을 함께 사용하는 유형입니다. 본문 하단에 부가 정보와 채널 추가 영역이 모두 포함됩니다.",
    bullets: [
      "본문, 부가 정보, 채널 추가 영역을 한 번에 조합한 구조입니다.",
      "정기 안내와 채널 유입을 함께 관리해야 할 때 적합합니다.",
      "정책상 정보성 본문과 고정 부가 정보, 채널 추가 문구의 역할이 분명해야 합니다.",
    ],
    imageUrl: KAKAO_GUIDE_IMAGES.messageMixed,
    imageAlt: "카카오 알림톡 복합형 공식 예시",
    note: "공식 문서 기준 복합형은 부가정보형과 채널추가형 요소를 동시에 포함합니다.",
    exampleTitle: "복합형 예시 메시지",
    exampleMessage:
      "[아가잼잼]\n#{고객명}님, 이번 달 서비스 일정 안내드립니다.\n\n• 다음 방문: #{방문일시}\n• 담당자: #{담당자명}\n\n[부가 정보]\n문의 가능 시간: 평일 09:00~18:00\n\n+ 채널 추가하고 이 채널의 마케팅 메시지 등을 카카오톡으로 받기",
    exampleCaption: "공식 구조를 이해하기 위한 예시이며, 실제 사용 시에는 카카오 심사 정책에 맞게 문안을 정리해야 합니다.",
  },
];

const EMPHASIS_GUIDE_SECTIONS: GuideExampleSection[] = [
  {
    id: "basic",
    label: "기본형",
    title: "강조 요소를 쓰지 않는 기본형",
    summary:
      "현재 선택값 기본형은 카카오 강조 요소를 추가하지 않는 상태입니다. 별도 타이틀이나 이미지를 두지 않고 본문과 버튼 중심으로 메시지를 구성합니다.",
    bullets: [
      "본문 정보만으로 충분히 명확한 안내에 적합합니다.",
      "강조표기형이나 이미지형을 쓰지 않을 때의 기본 레이아웃입니다.",
      "이 화면에서는 기본형 선택 시 추가 강조 입력 항목이 나타나지 않습니다.",
    ],
    note: "카카오 공식 가이드는 강조표기형과 이미지형의 상세 예시를 제공하므로, 기본형은 현재 작성 방식 기준으로 정리했습니다.",
  },
  {
    id: "text",
    label: "강조표기형",
    title: "강조표기형 예시",
    summary:
      "강조표기형은 본문에서 꼭 보여야 하는 문구를 말풍선 상단의 타이틀과 서브타이틀로 올려 강조하는 방식입니다.",
    bullets: [
      "중요 일정, 금액, 상태 변경처럼 한눈에 인지되어야 하는 정보에 적합합니다.",
      "현재 화면은 공식 가이드 흐름에 맞춰 타이틀과 서브타이틀을 별도로 입력하도록 구성되어 있습니다.",
      "카카오 공식 문서는 템플릿 등록 기준과 실제 디바이스 표시 권장 길이가 다를 수 있으므로 보수적으로 작성하는 편이 안전합니다.",
    ],
    imageUrl: KAKAO_GUIDE_IMAGES.emphasisText,
    imageAlt: "카카오 알림톡 강조표기형 공식 예시",
    note: "강조표기형과 이미지형은 동시에 사용할 수 없습니다.",
  },
  {
    id: "image",
    label: "이미지형",
    title: "이미지형 예시",
    summary:
      "이미지형은 메시지 상단에 본문과 연관된 이미지를 배치해 주목도를 높이는 방식으로, 카카오 공식 가이드에서도 정보성 메시지 중심의 사용을 권장합니다.",
    bullets: [
      "본문 목적과 직접 관련된 고정 이미지 1장을 사용하는 흐름입니다.",
      "광고성 메시지나 광고성 이미지는 허용되지 않으며 정보 전달 목적이 분명해야 합니다.",
      "현재 작성 화면의 이미지 업로드 입력은 이 공식 가이드 흐름에 맞춰 PNG/JPEG만 받도록 되어 있습니다.",
    ],
    imageUrl: KAKAO_GUIDE_IMAGES.emphasisImage,
    imageAlt: "카카오 알림톡 이미지형 공식 예시",
    note: "이미지형은 강조표기형과 함께 쓸 수 없고, 카카오 이미지 제작 가이드를 함께 지켜야 합니다.",
  },
];

const TPL_TYPE_OPTIONS: { value: TplType; label: string }[] = [
  { value: "BA", label: "기본형" },
  { value: "EX", label: "부가 정보형" },
  { value: "AD", label: "광고 추가형" },
  { value: "MI", label: "복합형" },
];

const TPL_EMTYPE_OPTIONS: { value: TplEmType; label: string }[] = [
  { value: "NONE", label: "기본형" },
  { value: "TEXT", label: "강조표기형" },
  { value: "IMAGE", label: "이미지형" },
];

const BUTTON_LINK_TYPES: { value: ButtonLinkType; label: string }[] = [
  { value: "WL", label: "웹링크" },
  { value: "AL", label: "앱링크" },
  { value: "BK", label: "봇키워드" },
  { value: "MD", label: "메시지전달" },
  { value: "DS", label: "배송조회" },
  { value: "AC", label: "채널추가" },
];

const TEMPLATE_GROUP_TABS = [
  { value: "builtin", label: "승인 완료" },
  { value: "custom", label: "심사중/반려" },
] as const;

const TEMPLATE_DETAIL_TABS = [
  { key: "details", label: "상세정보" },
  { key: "preview", label: "미리보기" },
] as const;

const EMPTY_BUTTON: TemplateButton = { name: "", linkType: "WL", linkM: "", linkP: "", linkI: "", linkA: "" };

const INPUT_CLASS =
  "mt-1.5 w-full px-3.5 py-2.5 rounded-xl border border-[hsl(var(--v3-border))] bg-white text-[0.8rem] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--v3-primary))]/20 focus:border-[hsl(var(--v3-primary))] transition-all placeholder:text-v3-text-muted/50";
const SELECT_CLASS =
  "mt-1.5 w-full px-3.5 py-2.5 rounded-xl border border-[hsl(var(--v3-border))] bg-white text-[0.8rem] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--v3-primary))]/20 focus:border-[hsl(var(--v3-primary))] transition-all appearance-none cursor-pointer";

const BUILTIN_TEMPLATES: TemplateRecord[] = [
  {
    id: "builtin-client-created",
    name: "고객 등록 안내",
    description: "고객 등록 직후 보내는 첫 안내 메시지",
    group: "builtin",
    tplType: "BA",
    tplEmType: "TEXT",
    title: "등록이 완료되었어요",
    subtitle: "첫 안내 메시지",
    content:
      "#{고객명}님, 안녕하세요.\n아가잼잼 서비스 등록이 완료되었습니다.\n\n담당 매니저가 배정되면 다시 안내드릴게요.\n문의사항은 언제든 편하게 연락 주세요.",
    buttons: [{ name: "서비스 안내", linkType: "WL", linkM: "https://agajamjam.kr", linkP: "https://agajamjam.kr", linkI: "", linkA: "" }],
    updatedAt: "2026.03.08",
    status: "승인완료",
    provider: "알리고 API",
  },
  {
    id: "builtin-service-reminder",
    name: "서비스 시작 리마인드",
    description: "서비스 시작 하루 전 고객 안내",
    group: "builtin",
    tplType: "EX",
    tplEmType: "NONE",
    content:
      "#{고객명}님, 내일부터 서비스가 시작됩니다.\n\n■ 서비스 일정\n- 시작일: #{시작일}\n- 담당자: #{담당자명}\n- 방문 시간: #{방문시간}\n\n필요한 준비사항은 앱에서 확인해 주세요.",
    extra: "방문 전날 오후 6시에 자동 발송",
    buttons: [{ name: "준비사항 보기", linkType: "WL", linkM: "https://agajamjam.kr/app", linkP: "https://agajamjam.kr/app", linkI: "", linkA: "" }],
    updatedAt: "2026.03.06",
    status: "승인완료",
    provider: "알리고 API",
  },
  {
    id: "builtin-service-end",
    name: "서비스 종료 안내",
    description: "서비스 종료 전 고객 재안내 메시지",
    group: "builtin",
    tplType: "AD",
    tplEmType: "NONE",
    content:
      "#{고객명}님, 서비스 종료 예정일이 하루 남았습니다.\n\n■ 종료 정보\n- 종료일: #{종료일}\n- 담당자: #{담당자명}\n\n연장이 필요하시면 관리자에게 문의해 주세요.",
    advert: "서비스 연장 상담은 앱 또는 고객센터에서 가능합니다.",
    buttons: [],
    updatedAt: "2026.03.05",
    status: "승인완료",
    provider: "알리고 API",
  },
];

const CUSTOM_TEMPLATES: TemplateRecord[] = [
  {
    id: "custom-employee-assigned",
    name: "관리사 배정 완료",
    description: "관리사 배정 시 직원에게 발송되는 템플릿",
    group: "custom",
    tplType: "BA",
    tplEmType: "TEXT",
    title: "새 배정이 도착했어요",
    subtitle: "#{고객명} 고객",
    content:
      "#{직원명}님, 새로운 배정이 등록되었습니다.\n\n■ 배정 정보\n- 고객명: #{고객명}\n- 서비스 시작: #{시작일}\n- 주소: #{서비스주소}\n\n배정 내용을 확인해 주세요.",
    buttons: [{ name: "배정 상세 보기", linkType: "WL", linkM: "https://agajamjam.kr/staff", linkP: "https://agajamjam.kr/staff", linkI: "", linkA: "" }],
    updatedAt: "2026.03.07",
    status: "승인완료",
    provider: "알리고 API",
  },
  {
    id: "custom-7days-before-start",
    name: "서비스 7일 전 안내",
    description: "서비스 시작 7일 전 고객에게 보내는 커스텀 템플릿",
    group: "custom",
    tplType: "MI",
    tplEmType: "TEXT",
    title: "곧 서비스를 시작해요",
    subtitle: "7일 전 사전 안내",
    content:
      "#{고객명}님, 서비스 시작까지 7일 남았습니다.\n\n필요 서류와 준비사항을 미리 확인해 주세요.\n담당 매니저가 일정에 맞춰 다시 연락드릴 예정입니다.",
    extra: "필요 서류: 산모수첩, 신분증, 서비스 신청서",
    advert: "문의는 카카오 채널 또는 앱 1:1 문의로 남겨 주세요.",
    buttons: [{ name: "준비물 체크", linkType: "WL", linkM: "https://agajamjam.kr/checklist", linkP: "https://agajamjam.kr/checklist", linkI: "", linkA: "" }],
    updatedAt: "2026.03.08",
    status: "심사중",
    provider: "알리고 API",
  },
];

function extractVariables(content: string) {
  const matches = content.match(/#\{[^}]+\}/g);
  return matches ? [...new Set(matches)] : [];
}

function requiresAdvertField(tplType: TplType) {
  return tplType === "AD" || tplType === "MI";
}

function buildPreviewContent(tplType: TplType, content: string) {
  const normalizedContent = content.trim();
  if (!normalizedContent) return "";
  return requiresAdvertField(tplType) ? `(광고)\n${normalizedContent}` : normalizedContent;
}

function getButtonValidationError(button: TemplateButton, index: number) {
  if (!button.name.trim()) {
    return `버튼 ${index + 1}의 이름을 입력해 주세요.`;
  }

  if (button.linkType === "WL" && (!button.linkM.trim() || !button.linkP.trim())) {
    return `버튼 ${index + 1}의 웹링크는 모바일/PC 주소를 모두 입력해야 합니다.`;
  }

  if (button.linkType === "AL" && (!button.linkI.trim() || !button.linkA.trim())) {
    return `버튼 ${index + 1}의 앱링크는 iOS/Android 스킴을 모두 입력해야 합니다.`;
  }

  return null;
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
  return `${(size / (1024 * 1024)).toFixed(1)}MB`;
}

async function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("이미지 미리보기를 생성하지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

function getTplTypeLabel(type: TplType) {
  return TPL_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

function getTplEmTypeLabel(type: TplEmType) {
  return TPL_EMTYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

function getButtonLinkTypeLabel(type: ButtonLinkType) {
  return BUTTON_LINK_TYPES.find((option) => option.value === type)?.label ?? type;
}

function GuideExampleDialog({
  triggerLabel,
  title,
  description,
  sections,
  initialSectionId,
}: {
  triggerLabel: string;
  title: string;
  description: string;
  sections: GuideExampleSection[];
  initialSectionId: string;
}) {
  const [open, setOpen] = useState(false);
  const effectiveInitialSectionId = sections.some((section) => section.id === initialSectionId)
    ? initialSectionId
    : sections[0]?.id ?? "";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto px-0 py-0 text-[0.72rem] font-semibold text-v3-primary hover:bg-transparent hover:text-v3-primary/80"
        >
          <CircleHelp className="h-3.5 w-3.5" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="!w-[min(96vw,980px)] !max-w-[980px] !h-[min(88vh,860px)] gap-0 overflow-hidden rounded-[28px] border-v3-border p-0">
        <DialogHeader className="gap-3 border-b border-v3-border bg-v3-dim-white/40 px-6 py-5 pr-14 text-left">
          <div data-component="alimtalk-guide-dialog-header" className="flex items-start justify-between gap-4">
            <div data-component="alimtalk-guide-dialog-title-group" className="space-y-2">
              <DialogTitle className="text-[1.05rem] font-bold text-v3-dark">{title}</DialogTitle>
              <DialogDescription className="text-[0.78rem] leading-relaxed text-v3-text-muted">
                {description}
              </DialogDescription>
            </div>
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <a href={KAKAO_TEMPLATE_GUIDE_URL} target="_blank" rel="noreferrer">
                공식 문서
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          </div>
        </DialogHeader>

        <Tabs
          key={open ? effectiveInitialSectionId : "closed"}
          defaultValue={effectiveInitialSectionId}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div data-component="alimtalk-guide-dialog-tabs" className="border-b border-v3-border px-6 py-4">
            <TabsList
              className={cn(
                "grid h-auto w-full gap-2 rounded-[18px] bg-transparent p-0",
                sections.length >= 4 ? "grid-cols-2 sm:grid-cols-4" : sections.length === 3 ? "grid-cols-3" : "grid-cols-2"
              )}
            >
              {sections.map((section) => (
                <TabsTrigger
                  key={section.id}
                  value={section.id}
                  className="rounded-[14px] border border-v3-border bg-white px-4 py-2.5 text-[0.78rem] font-semibold text-v3-text-muted shadow-none data-[state=active]:border-v3-primary data-[state=active]:bg-v3-primary/5 data-[state=active]:text-v3-primary data-[state=active]:shadow-none"
                >
                  {section.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {sections.map((section) => (
            <TabsContent
              key={section.id}
              value={section.id}
              className="mt-0 min-h-0 flex-1 overflow-y-auto px-6 py-5 outline-none"
            >
              <div data-component="alimtalk-guide-section-grid" className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(420px,460px)]">
                <div data-component="alimtalk-guide-section-content" className="space-y-4">
                  <div data-component="alimtalk-guide-section-summary" className="rounded-[22px] border border-v3-border bg-white p-5">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-v3-primary">
                      Kakao Guide
                    </p>
                    <h3 className="mt-2 text-[1rem] font-bold text-v3-dark">{section.title}</h3>
                    <p className="mt-2 text-[0.8rem] leading-relaxed text-v3-text-muted">
                      {section.summary}
                    </p>
                  </div>

                  <div data-component="alimtalk-guide-section-points" className="rounded-[22px] border border-v3-border bg-v3-dim-white/30 p-5">
                    <h4 className="text-[0.82rem] font-bold text-v3-dark">핵심 포인트</h4>
                    <ul className="mt-3 space-y-2">
                      {section.bullets.map((bullet) => (
                        <li key={bullet} className="flex items-start gap-2 text-[0.78rem] leading-relaxed text-v3-text-muted">
                          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-v3-primary" />
                          <span>{bullet}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {section.exampleMessage ? (
                    <div data-component="alimtalk-guide-section-example" className="rounded-[22px] border border-v3-border bg-white p-5">
                      <div data-component="alimtalk-guide-section-example-header" className="flex items-center justify-between gap-3">
                        <h4 className="text-[0.82rem] font-bold text-v3-dark">
                          {section.exampleTitle ?? "예시 메시지"}
                        </h4>
                        <span className="rounded-full bg-v3-primary/8 px-2.5 py-1 text-[0.68rem] font-semibold text-v3-primary">
                          Sample
                        </span>
                      </div>
                      <div data-component="alimtalk-guide-section-example-body" className="mt-3 overflow-hidden rounded-[18px] border border-v3-border bg-v3-dim-white/30">
                        <pre className="whitespace-pre-wrap px-4 py-4 text-[0.76rem] leading-relaxed text-v3-dark">
                          {section.exampleMessage}
                        </pre>
                      </div>
                      {section.exampleCaption ? (
                        <p className="mt-3 text-[0.74rem] leading-relaxed text-v3-text-muted">
                          {section.exampleCaption}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {section.note ? (
                    <div data-component="alimtalk-guide-section-note" className="rounded-[20px] border border-v3-primary/15 bg-v3-primary/5 px-4 py-3">
                      <p className="text-[0.76rem] leading-relaxed text-v3-primary">{section.note}</p>
                    </div>
                  ) : null}
                </div>

                <div data-component="alimtalk-guide-section-preview" className="space-y-3">
                  <div data-component="alimtalk-guide-section-image-card" className="rounded-[22px] border border-v3-border bg-white p-4">
                    <p className="text-[0.72rem] font-semibold text-v3-dark">공식 예시 이미지</p>
                    {section.imageUrl ? (
                      <div data-component="alimtalk-guide-section-image" className="mt-3 overflow-hidden rounded-[18px] border border-v3-border bg-v3-dim-white/30">
                        <div data-component="alimtalk-guide-section-image-frame" className="aspect-[3/4] w-full bg-white p-3">
                          <Image
                            src={section.imageUrl}
                            alt={section.imageAlt ?? section.title}
                            width={720}
                            height={960}
                            className="block h-full w-full object-contain"
                          />
                        </div>
                      </div>
                    ) : (
                      <div data-component="alimtalk-guide-section-image-empty" className="mt-3 rounded-[18px] border border-dashed border-v3-border bg-v3-dim-white/30 px-4 py-8 text-center text-[0.76rem] leading-relaxed text-v3-text-muted">
                        이 유형은 별도 강조 요소 없이 본문 중심으로 작성하는 기본 상태입니다.
                      </div>
                    )}
                  </div>

                  {section.imageUrl ? (
                    <div data-component="alimtalk-guide-section-image-note" className="rounded-[20px] border border-v3-border bg-v3-dim-white/30 px-4 py-3">
                      <p className="text-[0.74rem] leading-relaxed text-v3-text-muted">
                        공식 예시 이미지는 3:4 비율 카드에 맞춰 크게 보여주고, 원본 비율은 유지한 채 축소 없이 확인할 수 있게 구성했습니다.
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function TemplatePhonePreview({
  tplType,
  tplEmType,
  content,
  extra,
  advert,
  imagePreviewUrl,
  buttons,
}: {
  tplType: TplType;
  tplEmType: TplEmType;
  title?: string;
  subtitle?: string;
  content: string;
  extra?: string;
  advert?: string;
  imagePreviewUrl?: string;
  buttons: TemplateButton[];
}) {
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const previewContent = buildPreviewContent(tplType, content);
  const hasContent = previewContent.length > 0 || (tplEmType === "IMAGE" && Boolean(imagePreviewUrl));

  return (
    <div data-component="alimtalk-preview-phone" className="w-[320px] shrink-0">
      <div data-component="alimtalk-preview-shell" className="rounded-[44px] border-[3px] border-gray-800 bg-gray-800 shadow-2xl overflow-hidden">
        <div data-component="alimtalk-preview-statusbar" className="bg-gray-800 px-6 pt-3 pb-2 flex items-center justify-between">
          <span className="text-[0.65rem] text-gray-400 font-medium">{timeStr}</span>
          <div data-component="alimtalk-preview-status-icons" className="flex items-center gap-1.5">
            <Signal className="w-3 h-3 text-gray-400" />
            <Wifi className="w-3 h-3 text-gray-400" />
            <Battery className="w-3.5 h-3.5 text-gray-400" />
          </div>
        </div>

        <div data-component="alimtalk-preview-header" className="bg-[#B2C7D9] px-3 py-2 flex items-center gap-2">
          <ChevronLeft className="w-5 h-5 text-gray-700" />
          <div data-component="alimtalk-preview-header-title" className="flex items-center gap-2 flex-1 min-w-0">
            <div data-component="alimtalk-preview-header-avatar" className="w-8 h-8 rounded-full bg-[#FAE100] flex items-center justify-center shrink-0">
              <MessageCircle className="w-4 h-4 text-[#3C1E1E]" />
            </div>
            <span className="text-[0.8rem] font-bold text-gray-900 truncate">아가잼잼</span>
          </div>
        </div>

        <div data-component="alimtalk-preview-body" className="bg-[#B2C7D9] min-h-[520px] max-h-[520px] overflow-y-auto px-3 py-4 custom-scrollbar">
          {hasContent ? (
            <div data-component="alimtalk-preview-message-row" className="flex items-end gap-1.5">
              <div data-component="alimtalk-preview-message-avatar" className="w-9 h-9 rounded-full bg-[#FAE100] flex items-center justify-center shrink-0 self-start">
                <MessageCircle className="w-4 h-4 text-[#3C1E1E]" />
              </div>
              <div data-component="alimtalk-preview-message-content" className="flex flex-col gap-1 min-w-0 max-w-[85%]">
                <div data-component="alimtalk-preview-message-card" className="rounded-xl bg-white shadow-sm overflow-hidden">
                  {tplEmType === "IMAGE" ? (
                    imagePreviewUrl ? (
                      <div data-component="alimtalk-preview-message-image" className="border-b border-gray-100 bg-gray-50">
                        {/* Reference spec supports IMAGE emphasis with uploaded PNG/JPEG. */}
                        <Image
                          src={imagePreviewUrl}
                          alt="템플릿 이미지 미리보기"
                          width={640}
                          height={320}
                          className="h-40 w-full object-cover"
                        />
                      </div>
                    ) : (
                      <div data-component="alimtalk-preview-message-image-empty" className="px-3.5 pt-3 pb-1">
                        <div data-component="alimtalk-preview-message-image-placeholder" className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-center text-[0.68rem] text-gray-400">
                          이미지를 업로드하면 상단에 표시됩니다.
                        </div>
                      </div>
                    )
                  ) : null}

                  <div data-component="alimtalk-preview-message-text" className="px-3.5 py-3">
                    <pre className="text-[0.72rem] text-gray-800 leading-relaxed whitespace-pre-wrap font-sans break-all">
                      {previewContent}
                    </pre>
                  </div>

                  {(tplType === "EX" || tplType === "MI") && extra ? (
                      <div data-component="alimtalk-preview-message-extra" className="px-3.5 py-2 border-t border-gray-100 bg-gray-50/80">
                      <pre className="text-[0.65rem] text-gray-500 whitespace-pre-wrap font-sans">{extra}</pre>
                    </div>
                  ) : null}

                  {(tplType === "AD" || tplType === "MI") && advert ? (
                      <div data-component="alimtalk-preview-message-advert" className="px-3.5 py-2 border-t border-gray-100 bg-gray-50/80">
                      <p className="text-[0.6rem] text-gray-400">{advert}</p>
                    </div>
                  ) : null}

                  {buttons.length > 0 ? (
                      <div data-component="alimtalk-preview-message-buttons" className="border-t border-gray-100">
                      {buttons.map((button, index) => (
                        <button
                          type="button"
                          key={`preview-btn-${button.linkType}-${index}`}
                          className="w-full text-center py-2.5 text-[0.72rem] font-medium text-[#4A90D9] hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0"
                        >
                          {button.name || `버튼 ${index + 1}`}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <span className="text-[0.6rem] text-gray-600 pl-1">{timeStr}</span>
              </div>
            </div>
          ) : (
             <div data-component="alimtalk-preview-empty" className="flex items-center justify-center h-full min-h-[460px]">
               <div data-component="alimtalk-preview-empty-content" className="text-center">
                <MessageCircle className="w-8 h-8 mx-auto mb-2 text-gray-500/40" />
                <p className="text-[0.72rem] text-gray-600/70">
                  템플릿 내용을 입력하면
                  <br />
                  미리보기가 표시됩니다
                </p>
              </div>
            </div>
          )}
        </div>

        <div data-component="alimtalk-preview-inputbar" className="bg-[#EFF2F6] px-3 py-2.5 flex items-center gap-2">
          <div data-component="alimtalk-preview-input" className="flex-1 rounded-full bg-white px-3.5 py-2 text-[0.7rem] text-gray-400">메시지 입력</div>
          <div data-component="alimtalk-preview-send" className="w-8 h-8 rounded-full bg-[#FAE100] flex items-center justify-center shrink-0">
            <Send className="w-3.5 h-3.5 text-[#3C1E1E]" />
          </div>
        </div>

        <div data-component="alimtalk-preview-homebar" className="bg-gray-800 h-5 flex items-center justify-center">
          <div data-component="alimtalk-preview-homebar-indicator" className="w-28 h-1 rounded-full bg-gray-600" />
        </div>
      </div>
    </div>
  );
}

function TemplateCreator({
  onBack,
  onCreated,
}: {
  onBack: () => void;
  onCreated: (template: TemplateRecord) => void;
}) {
  const { toast } = useToast();
  const [tplName, setTplName] = useState("");
  const [tplContent, setTplContent] = useState("");
  const [tplEmType, setTplEmType] = useState<TplEmType>("NONE");
  const [tplTitle, setTplTitle] = useState("");
  const [tplSubtitle, setTplSubtitle] = useState("");
  const [tplExtra, setTplExtra] = useState("");
  const [tplImage, setTplImage] = useState<TemplateImageState | null>(null);
  const [buttons, setButtons] = useState<TemplateButton[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const addButton = useCallback(() => {
    if (buttons.length >= 5) return;
    setButtons((previous) => [...previous, { ...EMPTY_BUTTON }]);
  }, [buttons.length]);

  const removeButton = useCallback((index: number) => {
    setButtons((previous) => previous.filter((_, currentIndex) => currentIndex !== index));
  }, []);

  const updateButton = useCallback((index: number, field: keyof TemplateButton, value: string) => {
    setButtons((previous) =>
      previous.map((button, currentIndex) =>
        currentIndex === index ? { ...button, [field]: value } : button
      )
    );
  }, []);

  const handleTplEmTypeChange = useCallback((nextTplEmType: TplEmType) => {
    setTplEmType(nextTplEmType);

    if (nextTplEmType !== "TEXT") {
      setTplTitle("");
      setTplSubtitle("");
    }

    if (nextTplEmType !== "IMAGE") {
      setTplImage(null);
    }
  }, []);

  const handleImageChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      setTplImage(null);
      return;
    }

    if (!["image/png", "image/jpeg", "image/jpg"].includes(file.type)) {
      toast({
        variant: "destructive",
        description: "이미지형 템플릿은 PNG 또는 JPEG 파일만 업로드할 수 있습니다.",
      });
      event.target.value = "";
      return;
    }

    try {
      const previewUrl = await readFileAsDataUrl(file);

      setTplImage({
        file,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
        previewUrl,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        description:
          error instanceof Error ? error.message : "이미지 미리보기를 생성하지 못했습니다.",
      });
      event.target.value = "";
    }
  }, [toast]);

  const variables = useMemo(() => extractVariables(tplContent), [tplContent]);
  const normalizedButtons = useMemo(
    () =>
      buttons.map((button) => ({
        ...button,
        name: button.name.trim(),
        linkM: button.linkM.trim(),
        linkP: button.linkP.trim(),
        linkI: button.linkI.trim(),
        linkA: button.linkA.trim(),
      })),
    [buttons]
  );
  const tplType: TplType = tplExtra.trim() ? "EX" : "BA";
  const isTextHeadlineRequired = tplEmType === "TEXT";
  const isImageRequired = tplEmType === "IMAGE";
  const buttonValidationError = useMemo(() => {
    for (const [index, button] of normalizedButtons.entries()) {
      const error = getButtonValidationError(button, index);
      if (error) return error;
    }

    return null;
  }, [normalizedButtons]);
  const isSubmitDisabled =
    !tplName.trim() ||
    !tplContent.trim() ||
    isSubmitting ||
    (isTextHeadlineRequired && !tplTitle.trim()) ||
    (isImageRequired && !tplImage) ||
    Boolean(buttonValidationError);

  const handleSubmit = useCallback(async () => {
    const payload: TemplateSubmitPayload = {
      name: tplName.trim(),
      tplType,
      tplEmType,
      title: isTextHeadlineRequired ? tplTitle.trim() || undefined : undefined,
      subtitle: isTextHeadlineRequired ? tplSubtitle.trim() || undefined : undefined,
      content: tplContent.trim(),
      extra: tplExtra.trim() || undefined,
      advert: undefined,
      imagePreviewUrl: tplImage?.previewUrl,
      buttons: normalizedButtons,
    };

    let validationMessage: string | null = null;
    if (!payload.name) {
      validationMessage = "템플릿 이름을 입력해 주세요.";
    } else if (!payload.content) {
      validationMessage = "템플릿 내용을 입력해 주세요.";
    } else if (isTextHeadlineRequired && !payload.title) {
      validationMessage = "강조표기형 템플릿은 강조 제목을 입력해야 합니다.";
    } else if (isImageRequired && !tplImage) {
      validationMessage = "이미지형 템플릿은 PNG 또는 JPEG 이미지를 업로드해야 합니다.";
    } else if (buttonValidationError) {
      validationMessage = buttonValidationError;
    }

    if (validationMessage) {
      toast({
        variant: "destructive",
        description: validationMessage,
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.append("name", payload.name);
      formData.append("tplType", payload.tplType);
      formData.append("tplEmType", payload.tplEmType);
      formData.append("content", payload.content);
      formData.append("buttons", JSON.stringify(payload.buttons));

      if (payload.title) {
        formData.append("title", payload.title);
      }

      if (payload.subtitle) {
        formData.append("subtitle", payload.subtitle);
      }

      if (payload.extra) {
        formData.append("extra", payload.extra);
      }

      if (payload.advert) {
        formData.append("advert", payload.advert);
      }

      if (tplImage) {
        formData.append("image", tplImage.file, tplImage.fileName);
      }

      const response = await fetch("/api/alimtalk-templates", {
        method: "POST",
        body: formData,
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || (typeof data?.code === "number" && data.code !== 0)) {
        const message =
          (typeof data?.message === "string" && data.message) ||
          (typeof data?.error === "string" && data.error) ||
          "템플릿 등록 요청 중 오류가 발생했습니다.";
        throw new Error(message);
      }

      onCreated({
        id: `custom-${Date.now()}`,
        name: payload.name,
        description: "알리고 템플릿 심사 요청을 전송한 사용자 템플릿",
        group: "custom",
        tplType: payload.tplType,
        tplEmType: payload.tplEmType,
        title: payload.title,
        subtitle: payload.subtitle,
        content: payload.content,
        extra: payload.extra,
        advert: payload.advert,
        imagePreviewUrl: payload.imagePreviewUrl,
        buttons: payload.buttons,
        updatedAt: new Date().toISOString().slice(0, 10).replace(/-/g, "."),
        status: "심사중",
        provider: "알리고 API",
      });

      toast({
        description:
          (typeof data?.message === "string" && data.message) ||
          "알리고에 템플릿 등록 요청을 전송했습니다. 심사 상태는 알리고 콘솔에서 확인해 주세요.",
      });

      setTplName("");
      setTplContent("");
      setTplEmType("NONE");
      setTplTitle("");
      setTplSubtitle("");
      setTplExtra("");
      setTplImage(null);
      setButtons([]);
      onBack();
    } catch (error) {
      toast({
        variant: "destructive",
        description:
          error instanceof Error ? error.message : "템플릿 등록 요청 중 오류가 발생했습니다.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [
    normalizedButtons,
    onBack,
    onCreated,
    toast,
    tplContent,
    tplEmType,
    tplExtra,
    tplImage,
    tplName,
    tplSubtitle,
    tplTitle,
    tplType,
    buttonValidationError,
    isImageRequired,
    isTextHeadlineRequired,
  ]);

  return (
    <section data-component="alimtalk-template-creator" className="space-y-4">
      <HeaderActionButton
        icon={ChevronLeft}
        label="목록으로 돌아가기"
        onClick={onBack}
        variant="muted"
        className="w-fit"
      />

      <div data-component="alimtalk-template-creator-layout" className="flex flex-col lg:flex-row gap-8">
        <ContentPaper variant="v3" className="flex-1 min-w-0">
          <div data-component="alimtalk-template-creator-header" className="mb-4 flex items-center gap-3">
            <div data-component="alimtalk-template-creator-title-row" className="flex items-center gap-3">
              <div data-component="alimtalk-template-creator-icon" className="flex items-center justify-center w-10 h-10 rounded-xl bg-violet-500/10">
                <FileText size={20} className="text-violet-500" />
              </div>
              <div data-component="alimtalk-template-creator-title-group">
                <h2 className="text-lg font-bold text-foreground">새 템플릿 작성</h2>
                <p className="text-sm text-muted-foreground">알리고 API 기반 카카오 알림톡 템플릿</p>
              </div>
            </div>
          </div>
          <Separator className="mb-6" />

          <div data-component="alimtalk-template-creator-form" className="space-y-5">
            <div data-component="alimtalk-template-creator-name">
              <Label htmlFor="tpl-name" className="text-[0.8rem] font-semibold">
                템플릿 이름 *
              </Label>
              <input
                id="tpl-name"
                type="text"
                value={tplName}
                onChange={(event) => setTplName(event.target.value)}
                placeholder="예: 배송완료 안내"
                maxLength={30}
                className={INPUT_CLASS}
              />
            </div>

            <div data-component="alimtalk-template-creator-emphasis">
              <div data-component="alimtalk-template-creator-emphasis-header" className="flex items-center justify-between gap-3">
                <Label id="tpl-emtype-label" className="text-[0.8rem] font-semibold">
                  강조 유형 *
                </Label>
                <GuideExampleDialog
                  triggerLabel="예시보기"
                  title="강조 유형 공식 가이드"
                  description="카카오 공식 제작 가이드를 기준으로 현재 화면에서 지원하는 강조 유형 예시를 확인할 수 있습니다."
                  sections={EMPHASIS_GUIDE_SECTIONS}
                  initialSectionId={
                    tplEmType === "IMAGE" ? "image" : tplEmType === "TEXT" ? "text" : "basic"
                  }
                />
              </div>
              <div
                data-component="alimtalk-template-creator-emphasis-options"
                role="radiogroup"
                aria-labelledby="tpl-emtype-label"
                className="mt-1.5 grid gap-2 sm:grid-cols-3"
              >
                {TPL_EMTYPE_OPTIONS.map((option) => {
                  const isSelected = tplEmType === option.value;

                  return (
                    <label
                      key={option.value}
                      className={cn(
                        "flex min-h-11 cursor-pointer items-center justify-center rounded-xl border px-3 py-2.5 text-[0.78rem] font-semibold transition-colors",
                        isSelected
                          ? "border-v3-primary bg-v3-primary/5 text-v3-primary"
                          : "border-[hsl(var(--v3-border))] bg-white text-v3-dark hover:border-v3-primary/40 hover:text-v3-primary"
                      )}
                    >
                      <input
                        type="radio"
                        name="tpl-emtype"
                        value={option.value}
                        checked={isSelected}
                        onChange={() => handleTplEmTypeChange(option.value)}
                        className="sr-only"
                      />
                      {option.label}
                    </label>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[0.72rem] leading-relaxed text-v3-text-muted">
                기본형은 본문만 사용하고, 강조표기형은 타이틀과 서브타이틀을, 이미지형은 PNG/JPEG 이미지를 추가로 입력합니다.
              </p>
            </div>

            {isTextHeadlineRequired ? (
              <div data-component="alimtalk-template-creator-headline" className="space-y-4">
                <div data-component="alimtalk-template-creator-subtitle">
                  <Label htmlFor="tpl-stitle" className="text-[0.8rem] font-semibold">
                    서브타이틀
                  </Label>
                  <input
                    id="tpl-stitle"
                    type="text"
                    value={tplSubtitle}
                    onChange={(event) => setTplSubtitle(event.target.value)}
                    placeholder="타이틀에 해당하는 부연 설명을 입력해 주세요. (변수불가)"
                    maxLength={22}
                    className={INPUT_CLASS}
                  />
                  <p className="mt-1.5 text-[0.7rem] text-v3-text-muted">{tplSubtitle.length}/22자</p>
                </div>
                <div data-component="alimtalk-template-creator-title">
                  <Label htmlFor="tpl-title" className="text-[0.8rem] font-semibold">
                    타이틀 *
                  </Label>
                  <textarea
                    id="tpl-title"
                    value={tplTitle}
                    onChange={(event) => setTplTitle(event.target.value)}
                    placeholder="본문에서 강조하여 표현할 내용을 입력해 주세요."
                    rows={3}
                    maxLength={28}
                    className={cn(INPUT_CLASS, "min-h-[96px] resize-none")}
                  />
                  <p className="mt-1.5 text-[0.7rem] text-v3-text-muted">{tplTitle.length}/28자</p>
                </div>
              </div>
            ) : null}

            {isImageRequired ? (
              <div data-component="alimtalk-template-creator-image">
                <div data-component="alimtalk-template-creator-image-header" className="flex items-center justify-between gap-3">
                  <Label htmlFor="tpl-image" className="text-[0.8rem] font-semibold">
                    강조 이미지 *
                  </Label>
                  <GuideExampleDialog
                    triggerLabel="이미지 예시"
                    title="이미지형 공식 가이드"
                    description="카카오 공식 제작 가이드의 이미지형 설명과 예시 이미지를 바로 확인할 수 있습니다."
                    sections={EMPHASIS_GUIDE_SECTIONS}
                    initialSectionId="image"
                  />
                  {tplImage ? (
                    <button
                      type="button"
                      onClick={() => setTplImage(null)}
                      className="text-[0.72rem] font-semibold text-v3-primary hover:text-v3-primary/80 transition-colors"
                    >
                      이미지 제거
                    </button>
                  ) : null}
                </div>
                <input
                  id="tpl-image"
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={handleImageChange}
                  className={cn(
                    INPUT_CLASS,
                    "file:mr-3 file:rounded-lg file:border-0 file:bg-v3-primary file:px-3.5 file:py-2 file:text-[0.75rem] file:font-semibold file:text-white"
                  )}
                />
                <p className="mt-1.5 text-[0.72rem] text-v3-text-muted">
                  알리고 문서 기준 PNG/JPEG 파일만 업로드할 수 있습니다.
                </p>

                {tplImage ? (
                  <div data-component="alimtalk-template-creator-image-preview" className="mt-3 overflow-hidden rounded-xl border border-v3-border bg-white">
                    <Image
                      src={tplImage.previewUrl}
                      alt="강조 이미지 미리보기"
                      width={960}
                      height={384}
                      className="h-48 w-full object-cover"
                    />
                    <div data-component="alimtalk-template-creator-image-meta" className="flex items-center justify-between gap-3 border-t border-v3-border px-4 py-3 text-[0.72rem] text-v3-text-muted">
                      <span className="truncate">{tplImage.fileName}</span>
                      <span className="shrink-0">{formatFileSize(tplImage.size)}</span>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div data-component="alimtalk-template-creator-content">
              <div data-component="alimtalk-template-creator-content-header" className="flex items-center justify-between gap-3">
                <Label htmlFor="tpl-content" className="text-[0.8rem] font-semibold">
                  템플릿 내용 *
                </Label>
                <GuideExampleDialog
                  triggerLabel="유형 예시"
                  title="메시지 유형 공식 가이드"
                  description="카카오 공식 제작 가이드의 메시지 유형 탭을 기준으로 기본형, 부가정보형, 채널추가형, 복합형 예시를 확인할 수 있습니다."
                  sections={MESSAGE_TYPE_GUIDE_SECTIONS}
                  initialSectionId="basic"
                />
              </div>
              <textarea
                id="tpl-content"
                value={tplContent}
                onChange={(event) => setTplContent(event.target.value)}
                placeholder={"#{고객명}님, 안녕하세요.\n주문하신 상품이 발송되었습니다.\n\n■ 주문 정보\n- 상품: #{상품명}\n- 송장번호: #{송장번호}"}
                rows={8}
                maxLength={1000}
                className={cn(INPUT_CLASS, "resize-none")}
              />
              <p className="mt-1.5 text-[0.7rem] text-v3-text-muted">
                변수는 {"#{변수명}"} 형식으로 입력하세요. ({tplContent.length}/1,000자)
              </p>
            </div>

            {variables.length > 0 ? (
              <div data-component="alimtalk-template-creator-variables" className="flex flex-wrap gap-1.5">
                {variables.map((variable) => (
                  <span
                    key={variable}
                    className="inline-flex items-center px-2.5 py-1 rounded-lg bg-v3-primary/5 border border-v3-primary/20 text-[0.7rem] font-medium text-v3-primary"
                  >
                    {variable}
                  </span>
                ))}
              </div>
            ) : null}

            <div data-component="alimtalk-template-creator-extra">
              <div data-component="alimtalk-template-creator-extra-header" className="flex items-center justify-between gap-3">
                <Label htmlFor="tpl-extra" className="text-[0.8rem] font-semibold">
                  부가 정보
                </Label>
                <GuideExampleDialog
                  triggerLabel="부가정보형 예시"
                  title="부가정보형 공식 가이드"
                  description="부가 정보 입력란이 카카오 메시지 유형 전체 구조에서 어디에 해당하는지 공식 탭 예시로 확인할 수 있습니다."
                  sections={MESSAGE_TYPE_GUIDE_SECTIONS}
                  initialSectionId="extra"
                />
              </div>
              <textarea
                id="tpl-extra"
                value={tplExtra}
                onChange={(event) => setTplExtra(event.target.value)}
                placeholder="이용안내 등 보조적인 정보메시지를 입력해 주세요. (변수불가)"
                rows={3}
                maxLength={400}
                className={cn(INPUT_CLASS, "resize-none")}
              />
              <p className="mt-1.5 text-[0.72rem] text-v3-text-muted">
                입력하면 내부적으로 {getTplTypeLabel("EX")}으로 등록되고, 비워두면 {getTplTypeLabel("BA")}으로 등록됩니다.
              </p>
            </div>

            <div data-component="alimtalk-template-creator-buttons">
              <div data-component="alimtalk-template-creator-buttons-header" className="flex items-center justify-between mb-3">
                <Label className="text-[0.8rem] font-semibold">버튼 (최대 5개)</Label>
                <button
                  type="button"
                  onClick={addButton}
                  disabled={buttons.length >= 5}
                  className="inline-flex items-center gap-1 text-[0.75rem] font-semibold text-v3-primary hover:text-v3-primary/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> 버튼 추가
                </button>
              </div>

              {buttons.length === 0 ? (
                <div data-component="alimtalk-template-creator-buttons-empty" className="rounded-xl border border-dashed border-v3-border p-4 text-center text-[0.75rem] text-v3-text-muted">
                  버튼이 없습니다. 위의 &quot;버튼 추가&quot;를 눌러 추가하세요.
                </div>
              ) : null}

              <div data-component="alimtalk-template-creator-buttons-list" className="space-y-3">
                {buttons.map((button, index) => (
                  <div
                    data-component="alimtalk-template-creator-button-item"
                    key={`button-${button.linkType}-${index}`}
                    className="rounded-xl border border-v3-border p-4 space-y-3 bg-v3-dim-white/30"
                  >
                    <div data-component="alimtalk-template-creator-button-header" className="flex items-center justify-between">
                      <span className="text-[0.75rem] font-semibold text-v3-dark">버튼 {index + 1}</span>
                      <button
                        type="button"
                        onClick={() => removeButton(index)}
                        className="text-red-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div data-component="alimtalk-template-creator-button-grid" className="grid grid-cols-2 gap-3">
                      <div data-component="alimtalk-template-creator-button-name">
                        <Label className="text-[0.7rem]">버튼명</Label>
                        <input
                          type="text"
                          value={button.name}
                          onChange={(event) => updateButton(index, "name", event.target.value)}
                          placeholder="바로가기"
                          maxLength={14}
                          className={INPUT_CLASS}
                        />
                      </div>
                      <div data-component="alimtalk-template-creator-button-type">
                        <Label className="text-[0.7rem]">링크 타입</Label>
                        <select
                          value={button.linkType}
                          onChange={(event) => updateButton(index, "linkType", event.target.value as ButtonLinkType)}
                          className={SELECT_CLASS}
                        >
                          {BUTTON_LINK_TYPES.map((linkType) => (
                            <option key={linkType.value} value={linkType.value}>
                              {linkType.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {button.linkType === "WL" ? (
                      <div data-component="alimtalk-template-creator-button-web" className="space-y-2">
                        <div data-component="alimtalk-template-creator-button-web-grid" className="grid grid-cols-2 gap-3">
                          <div data-component="alimtalk-template-creator-button-web-mobile">
                            <Label className="text-[0.7rem]">모바일 링크 *</Label>
                            <input
                              type="url"
                              value={button.linkM}
                              onChange={(event) => updateButton(index, "linkM", event.target.value)}
                              placeholder="https://"
                              className={INPUT_CLASS}
                            />
                          </div>
                          <div data-component="alimtalk-template-creator-button-web-desktop">
                            <Label className="text-[0.7rem]">PC 링크 *</Label>
                            <input
                              type="url"
                              value={button.linkP}
                              onChange={(event) => updateButton(index, "linkP", event.target.value)}
                              placeholder="https://"
                              className={INPUT_CLASS}
                            />
                          </div>
                        </div>
                        <p className="text-[0.68rem] text-v3-text-muted">
                          웹링크 버튼은 모바일/PC 주소를 모두 입력해야 합니다.
                        </p>
                      </div>
                    ) : null}

                    {button.linkType === "AL" ? (
                      <div data-component="alimtalk-template-creator-button-app" className="space-y-2">
                        <div data-component="alimtalk-template-creator-button-app-grid" className="grid grid-cols-2 gap-3">
                          <div data-component="alimtalk-template-creator-button-app-ios">
                            <Label className="text-[0.7rem]">iOS 스킴 *</Label>
                            <input
                              type="text"
                              value={button.linkI}
                              onChange={(event) => updateButton(index, "linkI", event.target.value)}
                              placeholder="myapp://"
                              className={INPUT_CLASS}
                            />
                          </div>
                          <div data-component="alimtalk-template-creator-button-app-android">
                            <Label className="text-[0.7rem]">Android 스킴 *</Label>
                            <input
                              type="text"
                              value={button.linkA}
                              onChange={(event) => updateButton(index, "linkA", event.target.value)}
                              placeholder="myapp://"
                              className={INPUT_CLASS}
                            />
                          </div>
                        </div>
                        <p className="text-[0.68rem] text-v3-text-muted">
                          앱링크 버튼은 iOS/Android 스킴을 모두 입력해야 합니다.
                        </p>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              {buttonValidationError ? (
                <p className="mt-3 text-[0.72rem] text-red-500">{buttonValidationError}</p>
              ) : null}
            </div>

            <Separator />

            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitDisabled}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-v3-primary text-white text-[0.85rem] font-semibold hover:bg-v3-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              <Send className="w-4 h-4" />
              {isSubmitting ? "등록 요청 중..." : "템플릿 등록 요청"}
            </button>
          </div>
        </ContentPaper>

        <div data-component="alimtalk-template-creator-preview" className="flex justify-center lg:sticky lg:top-24 self-start">
          <TemplatePhonePreview
            tplType={tplType}
            tplEmType={tplEmType}
            title={tplTitle}
            subtitle={tplSubtitle}
            content={tplContent}
            extra={tplExtra}
            advert={undefined}
            imagePreviewUrl={tplImage?.previewUrl}
            buttons={normalizedButtons}
          />
        </div>
      </div>
    </section>
  );
}

function TemplateDetails({ template }: { template: TemplateRecord }) {
  const variables = useMemo(() => extractVariables(template.content), [template.content]);

  return (
    <div data-component="alimtalk-template-details">
      <div data-component="alimtalk-template-details-grid" className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div data-component="alimtalk-template-details-content" className="rounded-[20px] border border-v3-border bg-v3-dim-white/30 p-5 flex flex-col xl:row-span-3">
          <div data-component="alimtalk-template-details-content-header" className="mb-4">
            <div data-component="alimtalk-template-details-content-title">
              <h3 className="text-[0.9rem] font-bold text-v3-dark">메시지 본문</h3>
              <p className="text-[0.75rem] text-v3-text-muted mt-0.5">{template.description}</p>
            </div>
          </div>
          <div data-component="alimtalk-template-details-content-body" className="rounded-[18px] bg-white border border-v3-border p-4 flex-1 min-h-[240px]">
            <pre className="text-[0.78rem] leading-relaxed whitespace-pre-wrap font-sans text-v3-dark">
              {buildPreviewContent(template.tplType, template.content)}
            </pre>
          </div>
        </div>

        <div data-component="alimtalk-template-details-meta" className="rounded-[20px] border border-v3-border bg-white p-5 flex flex-col">
          <h3 className="text-[0.85rem] font-bold text-v3-dark mb-4">템플릿 정보</h3>
          <div data-component="alimtalk-template-details-meta-list" className="space-y-3 flex-1">
            <div data-component="alimtalk-template-details-meta-item" className="flex items-center justify-between gap-3 text-[0.78rem]">
              <span className="text-v3-text-muted">분류</span>
              <span className="font-semibold text-v3-dark">
                {template.group === "builtin" ? "기본 템플릿" : "등록 템플릿"}
              </span>
            </div>
            <div data-component="alimtalk-template-details-meta-item" className="flex items-center justify-between gap-3 text-[0.78rem]">
              <span className="text-v3-text-muted">등록 유형</span>
              <span className="font-semibold text-v3-dark">{getTplTypeLabel(template.tplType)}</span>
            </div>
            <div data-component="alimtalk-template-details-meta-item" className="flex items-center justify-between gap-3 text-[0.78rem]">
              <span className="text-v3-text-muted">강조 유형</span>
              <span className="font-semibold text-v3-dark">{getTplEmTypeLabel(template.tplEmType)}</span>
            </div>
            <div data-component="alimtalk-template-details-meta-item" className="flex items-center justify-between gap-3 text-[0.78rem]">
              <span className="text-v3-text-muted">최근 수정</span>
              <span className="font-semibold text-v3-dark">{template.updatedAt}</span>
            </div>
            <div data-component="alimtalk-template-details-meta-item" className="flex items-center justify-between gap-3 text-[0.78rem]">
              <span className="text-v3-text-muted">버튼 수</span>
              <span className="font-semibold text-v3-dark">{template.buttons.length}개</span>
            </div>
          </div>
        </div>

        <div data-component="alimtalk-template-details-variables" className="rounded-[20px] border border-v3-border bg-white p-5 flex flex-col">
          <h3 className="text-[0.85rem] font-bold text-v3-dark mb-4">변수</h3>
          <div data-component="alimtalk-template-details-variables-body" className="flex-1">
            {variables.length > 0 ? (
              <div data-component="alimtalk-template-details-variable-list" className="flex flex-wrap gap-2">
                {variables.map((variable) => (
                  <span
                    key={variable}
                    className="inline-flex items-center rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary"
                  >
                    {variable}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[0.75rem] text-v3-text-muted">등록된 변수가 없습니다.</p>
            )}
          </div>
        </div>

        <div data-component="alimtalk-template-details-buttons" className="rounded-[20px] border border-v3-border bg-white p-5 flex flex-col">
          <h3 className="text-[0.85rem] font-bold text-v3-dark mb-4">버튼 구성</h3>
          <div data-component="alimtalk-template-details-buttons-list" className="space-y-3 flex-1">
            {template.buttons.length > 0 ? (
              template.buttons.map((button, index) => (
                <div
                  data-component="alimtalk-template-details-button-item"
                  key={`${template.id}-button-${index}`}
                  className="flex items-center justify-between gap-3 rounded-[16px] border border-v3-border bg-v3-dim-white/30 px-4 py-3"
                >
                  <div data-component="alimtalk-template-details-button-text" className="min-w-0">
                    <p className="text-[0.78rem] font-semibold text-v3-dark truncate">{button.name || `버튼 ${index + 1}`}</p>
                    <p className="text-[0.72rem] text-v3-text-muted">{getButtonLinkTypeLabel(button.linkType)}</p>
                  </div>
                  <span className="text-[0.72rem] font-medium text-v3-text-muted truncate max-w-[55%] text-right">
                    {button.linkM || button.linkP || button.linkI || button.linkA || "-"}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-[0.75rem] text-v3-text-muted">등록된 버튼이 없습니다.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TemplatesSection() {
  const [customTemplates, setCustomTemplates] = useState<TemplateRecord[]>(CUSTOM_TEMPLATES);
  const [mode, setMode] = useState<TemplateMode>("browse");
  const [activeGroup, setActiveGroup] = useState<TemplateGroup>("builtin");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(BUILTIN_TEMPLATES[0]?.id ?? "");
  const [activeDetailTab, setActiveDetailTab] = useState<TemplateDetailTab>("details");
  const [mobilePanel, setMobilePanel] = useState(0);

  const visibleTemplates = useMemo(
    () => (activeGroup === "builtin" ? BUILTIN_TEMPLATES : customTemplates),
    [activeGroup, customTemplates]
  );

  const templateLibrary = useMemo(
    () => [...BUILTIN_TEMPLATES, ...customTemplates],
    [customTemplates]
  );

  const selectedTemplate = useMemo(
    () => templateLibrary.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templateLibrary]
  );

  const handleGroupChange = useCallback((value: string) => {
    if (value !== "builtin" && value !== "custom") return;

    const nextGroup = value as TemplateGroup;
    const nextTemplates = nextGroup === "builtin" ? BUILTIN_TEMPLATES : customTemplates;

    setActiveGroup(nextGroup);
    setSelectedTemplateId((previous) => {
      const previousTemplate = templateLibrary.find((template) => template.id === previous);
      if (previousTemplate?.group === nextGroup) return previous;
      return nextTemplates[0]?.id ?? "";
    });
    setActiveDetailTab("details");
    setMobilePanel(0);
  }, [customTemplates, templateLibrary]);

  const handleSelectTemplate = useCallback((templateId: string) => {
    setSelectedTemplateId(templateId);
    setActiveDetailTab("details");
    setMobilePanel(1);
  }, []);

  const handleCreatedTemplate = useCallback((template: TemplateRecord) => {
    setCustomTemplates((previous) => [template, ...previous]);
    setActiveGroup("custom");
    setSelectedTemplateId(template.id);
    setActiveDetailTab("details");
    setMobilePanel(0);
    setMode("browse");
  }, []);

  if (mode === "create") {
    return <TemplateCreator onBack={() => setMode("browse")} onCreated={handleCreatedTemplate} />;
  }

  return (
    <section
      data-component="alimtalk-templates-browser"
      className="h-[calc(100dvh-176px)] md:h-[calc(100dvh-64px)] min-h-[calc(100dvh-176px)] md:min-h-[calc(100dvh-64px)]"
    >
      <SplitLayout columns={2} activePanel={mobilePanel} hasSelection={!!selectedTemplate} onBack={() => setMobilePanel(0)}>
        <ListPanel
          title="알림톡 템플릿"
          tabs={TEMPLATE_GROUP_TABS.map((tab) => ({ value: tab.value, label: tab.label }))}
          activeTab={activeGroup}
          onTabChange={handleGroupChange}
          headerActions={<HeaderActionButton icon={Plus} label="새 템플릿" onClick={() => setMode("create")} />}
        >
          <div data-component="alimtalk-templates-list" className="space-y-2 pb-2">
            {visibleTemplates.length === 0 ? (
              <ListEmptyState
                name="alimtalk-templates-empty"
                message="등록된 템플릿이 없습니다."
              />
            ) : (
              visibleTemplates.map((template) => {
                const isSelected = template.id === selectedTemplateId;

                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => handleSelectTemplate(template.id)}
                    className={cn(
                      "w-full rounded-[18px] border p-4 text-left transition-all duration-200",
                      isSelected
                        ? "border-v3-primary bg-[hsl(var(--v3-primary-light))] shadow-[0_12px_32px_hsla(214,50%,20%,0.08)]"
                        : "border-v3-border bg-white hover:border-v3-primary/30 hover:bg-v3-primary-light/40"
                    )}
                  >
                    <div data-component="alimtalk-templates-item" className="flex items-start gap-3">
                      <div data-component="alimtalk-templates-item-icon" className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 shrink-0">
                        <FileText className="h-4 w-4 text-violet-500" />
                      </div>
                      <div data-component="alimtalk-templates-item-content" className="min-w-0 flex-1">
                        <div data-component="alimtalk-templates-item-header" className="flex items-center justify-between gap-3">
                          <p className="truncate text-[0.82rem] font-semibold text-v3-dark">{template.name}</p>
                          <span
                            className={cn(
                              "shrink-0 rounded-full px-2.5 py-1 text-[0.65rem] font-semibold",
                              template.status === "승인완료"
                                ? "bg-emerald-500/10 text-emerald-600"
                                : "bg-amber-500/10 text-amber-600"
                            )}
                          >
                            {template.status}
                          </span>
                        </div>
                        <p className="mt-1 text-[0.73rem] text-v3-text-muted">{template.description}</p>
                        <div data-component="alimtalk-templates-item-tags" className="mt-3 flex flex-wrap gap-2">
                          <span className="rounded-full bg-v3-dim-white px-2.5 py-1 text-[0.68rem] font-medium text-v3-text-muted">
                            {getTplTypeLabel(template.tplType)}
                          </span>
                          <span className="rounded-full bg-v3-dim-white px-2.5 py-1 text-[0.68rem] font-medium text-v3-text-muted">
                            {getTplEmTypeLabel(template.tplEmType)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </ListPanel>

        <DetailPanel
          title={selectedTemplate?.name ?? "템플릿 상세"}
          subtitle={
            selectedTemplate
              ? `${selectedTemplate.group === "builtin" ? "기본 템플릿" : "등록 템플릿"} · ${selectedTemplate.provider}`
              : "왼쪽 목록에서 템플릿을 선택해 주세요."
          }
          badges={
            selectedTemplate ? (
              <span
                className={cn(
                  "rounded-full px-3 py-1 text-[0.7rem] font-semibold",
                  selectedTemplate.status === "승인완료"
                    ? "bg-emerald-500/10 text-emerald-600"
                    : "bg-amber-500/10 text-amber-600"
                )}
              >
                {selectedTemplate.status}
              </span>
            ) : null
          }
          trailing={
            <HeaderActionButton icon={FilePen} label="수정" onClick={() => setMode("create")} />
          }
          tabs={
            selectedTemplate ? (
              <DetailTabs
                tabs={TEMPLATE_DETAIL_TABS.map((tab) => ({ key: tab.key, label: tab.label }))}
                activeTab={activeDetailTab}
                onTabChange={(key) => setActiveDetailTab(key as TemplateDetailTab)}
              />
            ) : null
          }
        >
          {!selectedTemplate ? (
            <div data-component="alimtalk-templates-detail-empty" className="rounded-[16px] border border-dashed border-v3-border p-8 text-center text-sm text-v3-text-muted">
              왼쪽 목록에서 템플릿을 선택해 주세요.
            </div>
          ) : activeDetailTab === "details" ? (
            <TemplateDetails template={selectedTemplate} />
          ) : (
            <div data-component="alimtalk-templates-preview-panel" className="flex justify-center py-2">
              <TemplatePhonePreview
                tplType={selectedTemplate.tplType}
                tplEmType={selectedTemplate.tplEmType}
                title={selectedTemplate.title}
                subtitle={selectedTemplate.subtitle}
                content={selectedTemplate.content}
                extra={selectedTemplate.extra}
                advert={selectedTemplate.advert}
                imagePreviewUrl={selectedTemplate.imagePreviewUrl}
                buttons={selectedTemplate.buttons}
              />
            </div>
          )}
        </DetailPanel>
      </SplitLayout>
    </section>
  );
}

export default function AlimtalkPage() {
  const [activeSection, setActiveSection] = useState<SectionId>("overview");

  return (
    <section data-component="alimtalk" className="space-y-6">
      <div data-component="alimtalk-content" className="flex flex-col lg:flex-row gap-8">
        <SectionNav
          items={NAV_SECTIONS}
          activeId={activeSection}
          onSelect={(id) => setActiveSection(id as SectionId)}
        />

        <div data-component="alimtalk-sections" className="flex-1 min-w-0">
          {activeSection === "overview" ? (
            <section data-component="alimtalk-overview">
              <UpcomingAlimtalkManager />
            </section>
          ) : null}

          {activeSection === "history" ? (
            <section data-component="alimtalk-history">
              <AlimtalkHistoryManager />
            </section>
          ) : null}

          {activeSection === "templates" ? <TemplatesSection /> : null}

          {activeSection === "triggers" ? (
            <section data-component="alimtalk-triggers">
              <TriggerRulesManager />
            </section>
          ) : null}

          {activeSection === "settings" ? (
            <section data-component="alimtalk-settings">
              <AlimtalkTenantApplicationSettings />
            </section>
          ) : null}
        </div>
      </div>
    </section>
  );
}
