"use client";

import { useDeferredValue, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  Building2,
  CheckCircle2,
  Clock3,
  EllipsisVertical,
  KeyRound,
  Landmark,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  DetailPanel,
  InfoCard,
  InfoRow,
  ListEmptyState,
  ListPanel,
  PageSection,
  SectionNav,
  SplitLayout,
  StatsBar,
  type StatsBarItem,
} from "@/components/app/v3";
import { NotificationTestSection } from "@/components/app/settings/NotificationTestSection";
import { VoucherPriceUploadForm } from "@/components/app/settings/VoucherPriceUploadForm";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/app/ui/status-badge";
import { TagPill } from "@/components/app/ui/tag-pill";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type AdminSectionId = "signups" | "branches" | "accounts" | "notifications" | "subsidies";
type StatusVariant = "warning" | "info" | "success" | "destructive";

interface AdminMetric {
  label: string;
  value: string;
  helper: string;
}

interface AdminDetailRow {
  label: string;
  value: string;
}

interface AdminRequest {
  category: string;
  statusLabel: string;
  detailRows: readonly AdminDetailRow[];
  applicantRows?: readonly AdminDetailRow[];
}

interface AdminRecord {
  id: string;
  title: string;
  subtitle: string;
  listTitle?: string;
  listSubtitle?: string;
  listSummary?: string;
  listBadgeLabel?: string;
  listStatusLabel?: string;
  category: string;
  statusLabel: string;
  statusVariant: StatusVariant;
  updatedAt: string;
  owner: string;
  summary: string;
  tags: readonly string[];
  detailRows: readonly AdminDetailRow[];
  applicantRows?: readonly AdminDetailRow[];
  metrics?: readonly AdminMetric[];
  checklist?: readonly string[];
  notes?: readonly string[];
  requests?: readonly AdminRequest[];
}

interface AdminSection {
  id: AdminSectionId;
  label: string;
  icon: LucideIcon;
  description: string;
  listTitle: string;
  listSubtitle: string;
  searchPlaceholder: string;
  tabs?: readonly { label: string; value: string; activeClassName?: string; indicatorClassName?: string }[];
  stats: readonly StatsBarItem[];
  emptyMessage: string;
  detailEmptyMessage: string;
  records: readonly AdminRecord[];
}

interface SectionViewState {
  tab: string;
  search: string;
  selectedRecordId: string | null;
}

function getAdminRequestPillVariant(category: string) {
  switch (category) {
    case "signup":
      return "warning";
    case "messaging":
      return "info";
    default:
      return "success";
  }
}

function getAdminTagPillVariant(sectionId: AdminSectionId) {
  switch (sectionId) {
    case "signups":
      return "amber";
    case "branches":
      return "emerald";
    case "accounts":
      return "sky";
    case "subsidies":
      return "cyan";
    case "notifications":
      return "indigo";
    default:
      return "neutral";
  }
}

const PERSISTENT_SYSTEM_ADMIN_STATS: readonly StatsBarItem[] = [
  { icon: UserPlus, value: 1, label: "회원가입 신청", counter: "건" },
  { icon: Building2, value: 3, label: "지점 개설 신청", counter: "건", colorIndex: 1 },
  { icon: MessageSquare, value: 1, label: "메시지 신청", counter: "건", colorIndex: 2 },
  { icon: Bell, value: 1, label: "알림톡 신청", counter: "건" },
] as const;

const OWNER_ADMIN_SECTIONS: readonly AdminSection[] = [
  {
    id: "signups",
    label: "회원가입 관리",
    icon: UserPlus,
    description: "오너 승인 대상 신청을 `회원가입 신청`과 `메시지 발송 기능 신청` 두 흐름으로만 관리합니다.",
    listTitle: "회원가입 관리",
    listSubtitle: "회원가입 신청을 승인할 수 있어요",
    searchPlaceholder: "신청 유형, 기관명, 담당자 검색...",
    stats: PERSISTENT_SYSTEM_ADMIN_STATS,
    emptyMessage: "조건에 맞는 신청 요청이 없습니다.",
    detailEmptyMessage: "신청 항목을 선택하면 검토 정보가 표시됩니다.",
    records: [
      {
        id: "request-signup-haemil",
        title: "회원가입 신청",
        subtitle: "해밀어린이집 신규 기관 가입 요청",
        listTitle: "김서윤",
        listSubtitle: "2026.03.12 09:55 신청",
        listSummary: "해밀어린이집 본원",
        listBadgeLabel: "지점장",
        category: "signup",
        statusLabel: "승인 대기",
        statusVariant: "warning",
        updatedAt: "2026. 03. 12.",
        owner: "김서윤",
        summary: "새 기관 회원가입 신청으로, 기본 owner 계정 생성과 첫 지점 개설 승인이 함께 필요합니다.",
        tags: ["회원가입 신청", "신규 기관", "첫 지점"],
        detailRows: [
          { label: "이메일", value: "seoyun.kim@haemil.kr" },
          { label: "이름", value: "김서윤" },
          { label: "전화번호", value: "010-3487-2210" },
          { label: "생년월일", value: "1992-08-14" },
          { label: "지점명", value: "해밀어린이집 본원" },
          { label: "역할", value: "지점장" },
        ],
        metrics: [
          { label: "예상 승인 시간", value: "12분", helper: "초기 템플릿 자동 연결 포함" },
          { label: "동시 생성 계정", value: "2명", helper: "오너 1, 관리자 1" },
          { label: "서류 누락", value: "0건", helper: "필수 제출 서류 검증 완료" },
          { label: "지점 상태", value: "개설 준비", helper: "본원 기준 지점 1개 생성 예정" },
        ],
        checklist: [
          "사업자등록증 진위 여부를 마지막으로 확인합니다.",
          "대표자 연락처와 조직명 표기 규칙을 점검합니다.",
          "승인 즉시 사용할 기본 서비스 템플릿을 연결합니다.",
        ],
        notes: [
          "승인 후 24시간 내 첫 로그인 유도 알림을 발송합니다.",
          "초기 지점명은 '본원'으로 고정하고 변경은 관리자에서 처리합니다.",
        ],
      },
      {
        id: "request-messaging-noeul",
        title: "메시지 발송 기능 신청",
        subtitle: "노을 공동육아센터 알림톡/문자 발송 기능 활성화 요청",
        listTitle: "박진아",
        listSubtitle: "2026.03.12 09:33 신청",
        listSummary: "노을 공동육아센터 본원",
        listBadgeLabel: "매니저",
        category: "messaging",
        statusLabel: "검토 중",
        statusVariant: "info",
        updatedAt: "2026. 03. 12.",
        owner: "박진아",
        summary: "기존 기관에서 메시지 발송 기능 사용을 요청해 발신 프로필과 과금 정책 연결 여부를 확인해야 합니다.",
        tags: ["메시지 발송 기능 신청", "알림톡", "기존 기관"],
        detailRows: [
          { label: "신청 유형", value: "메시지 발송 기능 신청" },
          { label: "기관명", value: "노을 공동육아센터" },
          { label: "요청 기능", value: "알림톡 및 문자 발송" },
          { label: "발신 채널", value: "카카오 알림톡 + SMS" },
          { label: "쟁점", value: "발신 프로필 승인 필요" },
        ],
        applicantRows: [
          { label: "신청자", value: "박진아" },
          { label: "전화번호", value: "010-4567-8901" },
          { label: "이메일", value: "jina.park@example.com" },
          { label: "역할", value: "매니저" },
          { label: "신청 날짜", value: "2026-03-12" },
        ],
        metrics: [
          { label: "예상 활성화 시간", value: "1일", helper: "발신 프로필 승인 포함" },
          { label: "영향 계정", value: "5명", helper: "메시지 발송 권한 부여 대상" },
          { label: "템플릿 준비", value: "3건", helper: "기본 안내 템플릿 등록 예정" },
          { label: "과금 상태", value: "검토 필요", helper: "발송량 기준 요금제 확인" },
        ],
        checklist: [
          "카카오 발신 프로필 승인 상태를 확인합니다.",
          "메시지 발송 기능을 사용할 관리자 계정을 지정합니다.",
          "월 발송량 기준 요금제와 과금 정책을 검토합니다.",
        ],
        notes: [
          "승인 완료 후 기본 메시지 템플릿을 자동 연결합니다.",
          "발송 실패 모니터링을 첫 주 동안 강화합니다.",
        ],
      },
    ],
  },
  {
    id: "branches",
    label: "지점 관리",
    icon: Building2,
    description: "개설 예정 지점, 운영 중 지점, 점검 필요 지점을 분리해서 운영합니다.",
    listTitle: "지점 관리",
    listSubtitle: "각 지점의 승인 신청을 관리할 수 있어요",
    searchPlaceholder: "지점명, 지역, 담당자 검색...",
    tabs: [
      { label: "전체", value: "all" },
      { label: "개설", value: "launch" },
      { label: "메시지", value: "messaging" },
      { label: "알림톡", value: "alimtalk" },
    ],
    stats: [
      { icon: Building2, value: 12, label: "운영 지점", counter: "곳" },
      { icon: Clock3, value: 2, label: "개설 준비", counter: "곳" },
      { icon: AlertTriangle, value: 3, label: "점검 필요", counter: "곳", colorIndex: 1 },
      { icon: CheckCircle2, value: "98.2%", label: "이번 달 정상 운영", colorIndex: 2 },
    ],
    emptyMessage: "조건에 맞는 지점이 없습니다.",
    detailEmptyMessage: "지점을 선택하면 운영 메모와 체크리스트가 표시됩니다.",
    records: [
      {
        id: "branch-songdo-3",
        title: "송도 3호점 개설 준비",
        listTitle: "송도지점",
        listSubtitle: "",
        subtitle: "",
        category: "launch",
        statusLabel: "개설 신청",
        statusVariant: "warning",
        updatedAt: "2026. 03. 14.",
        owner: "이현지",
        summary: "개설 전 직원 배정과 정부지원금 기본 단가 연결이 마지막 단계입니다.",
        tags: [],
        detailRows: [
          { label: "지점명", value: "송도 3호점" },
          { label: "주소", value: "인천 연수구" },
          { label: "개업 날짜", value: "2026-03-16" },
        ],
        applicantRows: [
          { label: "신청자", value: "이현지" },
          { label: "전화번호", value: "010-1234-5678" },
          { label: "이메일", value: "hyunji.lee@example.com" },
          { label: "역할", value: "지점장" },
          { label: "신청 날짜", value: "2026-03-14" },
        ],
        metrics: [
          { label: "배정 대기 직원", value: "3명", helper: "첫 주 운영 스케줄 미확정" },
          { label: "설정 완료율", value: "82%", helper: "지점 기본 설정 9/11 완료" },
          { label: "문서 준비", value: "완료", helper: "기본 계약서/안내문 생성" },
          { label: "리스크", value: "지원금 단가", helper: "지역별 단가 매핑 확인 필요" },
        ],
        checklist: [
          "초기 고객 응대 계정을 기본 지점 권한으로 묶습니다.",
          "정부지원금 지역 단가표 연결 상태를 검증합니다.",
          "오픈 직후 1주일간 알림톡 발송량 제한을 점검합니다.",
        ],
        notes: [
          "오픈 당일 오전 8시에 지점 활성화 토글을 자동 반영합니다.",
          "첫 계약 생성 전까지 관리자에게 일일 상태 리포트를 보냅니다.",
        ],
      },
      {
        id: "branch-cheongna",
        title: "청라점",
        listTitle: "청라점",
        listSubtitle: "",
        subtitle: "",
        category: "launch",
        statusLabel: "개설 신청",
        statusVariant: "warning",
        updatedAt: "2026. 03. 12.",
        owner: "강하늘",
        summary: "",
        tags: [],
        detailRows: [
          { label: "지점명", value: "청라점" },
          { label: "주소", value: "인천 서구" },
          { label: "개업 날짜", value: "2026-03-20" },
        ],
        applicantRows: [
          { label: "신청자", value: "강하늘" },
          { label: "전화번호", value: "010-2345-6789" },
          { label: "이메일", value: "haneul.kang@example.com" },
          { label: "역할", value: "지점장" },
          { label: "신청 날짜", value: "2026-03-12" },
        ],
        metrics: [],
        checklist: [],
        notes: [],
        requests: [
          {
            category: "launch",
            statusLabel: "개설 신청",
            detailRows: [
              { label: "지점명", value: "청라점" },
              { label: "주소", value: "인천 서구" },
              { label: "개업 날짜", value: "2026-03-20" },
            ],
            applicantRows: [
              { label: "신청자", value: "강하늘" },
              { label: "전화번호", value: "010-2345-6789" },
              { label: "이메일", value: "haneul.kang@example.com" },
              { label: "역할", value: "지점장" },
              { label: "신청 날짜", value: "2026-03-12" },
            ],
          },
          {
            category: "messaging",
            statusLabel: "메시지 신청",
            detailRows: [
              { label: "기관명", value: "아가잼잼 청라점" },
              { label: "요청 기능", value: "SMS/LMS 발송" },
              { label: "발신번호", value: "등록 완료" },
              { label: "상태", value: "설정 진행 중" },
            ],
            applicantRows: [
              { label: "신청자", value: "강하늘" },
              { label: "전화번호", value: "010-2345-6789" },
              { label: "이메일", value: "haneul.kang@example.com" },
              { label: "역할", value: "지점장" },
              { label: "신청 날짜", value: "2026-03-12" },
            ],
          },
        ],
      },
      {
        id: "branch-bupyeong",
        title: "부평점",
        listTitle: "부평점",
        listSubtitle: "",
        subtitle: "",
        category: "launch",
        statusLabel: "개설 신청",
        statusVariant: "warning",
        updatedAt: "2026. 03. 10.",
        owner: "민서현",
        summary: "",
        tags: [],
        detailRows: [
          { label: "지점명", value: "부평점" },
          { label: "주소", value: "인천 부평구" },
          { label: "개업 날짜", value: "2026-03-25" },
        ],
        applicantRows: [
          { label: "신청자", value: "민서현" },
          { label: "전화번호", value: "010-3456-7890" },
          { label: "이메일", value: "seohyun.min@example.com" },
          { label: "역할", value: "지점장" },
          { label: "신청 날짜", value: "2026-03-10" },
        ],
        requests: [
          {
            category: "launch",
            statusLabel: "개설 신청",
            detailRows: [
              { label: "지점명", value: "부평점" },
              { label: "주소", value: "인천 부평구" },
              { label: "개업 날짜", value: "2026-03-25" },
            ],
            applicantRows: [
              { label: "신청자", value: "민서현" },
              { label: "전화번호", value: "010-3456-7890" },
              { label: "이메일", value: "seohyun.min@example.com" },
              { label: "역할", value: "지점장" },
              { label: "신청 날짜", value: "2026-03-10" },
            ],
          },
          {
            category: "messaging",
            statusLabel: "메시지 신청",
            detailRows: [
              { label: "기관명", value: "아가잼잼 부평점" },
              { label: "요청 기능", value: "SMS/LMS 발송" },
              { label: "발신번호", value: "미등록" },
              { label: "상태", value: "접수 대기" },
            ],
            applicantRows: [
              { label: "신청자", value: "민서현" },
              { label: "전화번호", value: "010-3456-7890" },
              { label: "이메일", value: "seohyun.min@example.com" },
              { label: "역할", value: "지점장" },
              { label: "신청 날짜", value: "2026-03-10" },
            ],
          },
          {
            category: "alimtalk",
            statusLabel: "알림톡 신청",
            detailRows: [
              { label: "기관명", value: "아가잼잼 부평점" },
              { label: "요청 기능", value: "카카오 알림톡 발송" },
              { label: "약관 동의", value: "3/3 완료" },
              { label: "상태", value: "접수 대기" },
            ],
            applicantRows: [
              { label: "신청자", value: "민서현" },
              { label: "전화번호", value: "010-3456-7890" },
              { label: "이메일", value: "seohyun.min@example.com" },
              { label: "역할", value: "지점장" },
              { label: "신청 날짜", value: "2026-03-10" },
            ],
          },
        ],
        metrics: [
          { label: "휴면 계정", value: "11개", helper: "관리자 재인증 필요" },
          { label: "알림 실패율", value: "4.8%", helper: "기준 2% 초과" },
          { label: "미확인 문서", value: "7건", helper: "업로드 검토 대기" },
          { label: "최근 점검", value: "12일 전", helper: "정기 점검 주기 초과" },
        ],
        checklist: [
          "휴면 계정 잠금 및 재활성화 프로세스를 실행합니다.",
          "알림 채널별 실패 원인을 발송 로그와 함께 분류합니다.",
          "이번 주 내 지점장 확인 코멘트를 수집합니다.",
        ],
        notes: [
          "문제 재현을 위해 지점 단위 샌드박스 발송 테스트가 필요합니다.",
          "이슈가 지속되면 권한 정비와 템플릿 정리를 함께 진행합니다.",
        ],
      },
      {
        id: "branch-noeul-alimtalk",
        title: "알림톡 발송 기능 신청",
        listTitle: "노을 공동육아센터",
        listSubtitle: "",
        subtitle: "",
        category: "alimtalk",
        statusLabel: "알림톡 신청",
        statusVariant: "warning",
        updatedAt: "2026. 03. 12.",
        owner: "박진아",
        summary: "약관 동의 완료 후 알림톡 발송 기능 활성화를 요청했습니다.",
        tags: [],
        detailRows: [
          { label: "기관명", value: "노을 공동육아센터" },
          { label: "지점명", value: "본원" },
          { label: "신청 일시", value: "2026-03-12 09:33" },
        ],
        applicantRows: [
          { label: "신청자", value: "박진아" },
          { label: "전화번호", value: "010-4567-8901" },
          { label: "이메일", value: "jina.park@example.com" },
          { label: "역할", value: "매니저" },
          { label: "신청 날짜", value: "2026-03-12" },
        ],
        metrics: [
          { label: "약관 동의", value: "3/3", helper: "알리고 이용약관 전체 동의" },
          { label: "발신 프로필", value: "미등록", helper: "카카오 발신 프로필 승인 필요" },
          { label: "예상 활성화", value: "1~2일", helper: "발신 프로필 승인 포함" },
          { label: "영향 계정", value: "5명", helper: "발송 권한 부여 대상" },
        ],
        checklist: [
          "알리고 API 키 발급과 발신번호 등록 상태를 확인합니다.",
          "카카오 발신 프로필 승인 절차를 안내합니다.",
          "기본 알림톡 템플릿을 연결합니다.",
        ],
        notes: [
          "승인 후 테스트 발송을 통해 정상 동작을 검증합니다.",
          "첫 주 발송 실패 모니터링을 강화합니다.",
        ],
      },
    ],
  },
  {
    id: "accounts",
    label: "계정 관리",
    icon: Users,
    description: "오너, 관리자, 매니저 계정의 역할과 보안 상태를 한 화면에서 검토합니다.",
    listTitle: "계정 관리",
    listSubtitle: "등록된 계정들을 관리할 수 있어요.",
    searchPlaceholder: "이름, 이메일, 조직, 역할 검색...",
    tabs: [
      { label: "전체", value: "all" },
      { label: "지점장", value: "branch-manager", activeClassName: "text-amber-700", indicatorClassName: "bg-amber-600" },
      { label: "매니저", value: "manager", activeClassName: "text-sky-700", indicatorClassName: "bg-sky-600" },
      { label: "관리자", value: "admin", activeClassName: "text-emerald-700", indicatorClassName: "bg-emerald-600" },
    ],
    stats: [
      { icon: Users, value: 128, label: "전체 계정", counter: "명" },
      { icon: ShieldCheck, value: 6, label: "오너 계정", counter: "명" },
      { icon: KeyRound, value: 4, label: "권한 변경 대기", counter: "건", colorIndex: 1 },
      { icon: AlertTriangle, value: 3, label: "보안 점검", counter: "건", colorIndex: 2 },
    ],
    emptyMessage: "조건에 맞는 계정이 없습니다.",
    detailEmptyMessage: "계정을 선택하면 권한 구조와 보안 메모가 표시됩니다.",
    records: [
      {
        id: "account-hq-owner",
        title: "본사 owner 계정 정비",
        listTitle: "정민호",
        listSubtitle: "본사",
        listStatusLabel: "관리자",
        subtitle: "결재선 변경에 따른 소유권 재배치",
        category: "admin",
        statusLabel: "권한 변경",
        statusVariant: "info",
        updatedAt: "11분 전",
        owner: "보안 담당 정민호",
        summary: "본사 owner 2명 체계에서 단일 승인 체계로 줄이기 위한 권한 조정 요청입니다.",
        tags: [],
        detailRows: [
          { label: "이름", value: "정민호" },
          { label: "이메일", value: "hq-owner@agajamjam.kr" },
          { label: "전화번호", value: "010-5678-1234" },
          { label: "생년월일", value: "1985-04-12" },
          { label: "역할", value: "관리자" },
          { label: "인증 방식", value: "이메일" },
          { label: "이메일 인증", value: "완료" },
          { label: "가입일", value: "2025-06-01" },
        ],
      },
      {
        id: "account-songdo-manager",
        title: "송도점 관리자 권한 부여",
        listTitle: "이현지",
        listSubtitle: "송도 3호점",
        listStatusLabel: "지점장",
        subtitle: "신규 지점 운영 준비에 따른 admin 승격",
        category: "branch-manager",
        statusLabel: "승격 검토",
        statusVariant: "warning",
        updatedAt: "49분 전",
        owner: "지역 운영 리더 이현지",
        summary: "오픈 예정 지점의 총괄 담당자를 manager에서 admin으로 조정하는 요청입니다.",
        tags: [],
        detailRows: [
          { label: "이름", value: "이현지" },
          { label: "이메일", value: "songdo.lead@agajamjam.kr" },
          { label: "전화번호", value: "010-1234-5678" },
          { label: "생년월일", value: "1990-08-22" },
          { label: "역할", value: "지점장" },
          { label: "인증 방식", value: "카카오" },
          { label: "이메일 인증", value: "완료" },
          { label: "가입일", value: "2025-09-15" },
        ],
      },
      {
        id: "account-bupyeong-security",
        title: "부평점 휴면 계정 잠금",
        listTitle: "민서현",
        listSubtitle: "부평점",
        listStatusLabel: "매니저",
        subtitle: "미사용 계정과 장기 미인증 계정 동시 정리",
        category: "manager",
        statusLabel: "보안 점검",
        statusVariant: "destructive",
        updatedAt: "2시간 전",
        owner: "품질 관리 민서현",
        summary: "장기 미사용 계정과 최근 인증 오류가 누적된 계정을 묶어 선제 잠금이 필요합니다.",
        tags: [],
        detailRows: [
          { label: "이름", value: "민서현" },
          { label: "이메일", value: "seohyun.min@agajamjam.kr" },
          { label: "전화번호", value: "010-3456-7890" },
          { label: "생년월일", value: "1992-11-03" },
          { label: "역할", value: "매니저" },
          { label: "인증 방식", value: "카카오" },
          { label: "이메일 인증", value: "완료" },
          { label: "가입일", value: "2026-01-10" },
        ],
      },
    ],
  },
  {
    id: "subsidies",
    label: "정부지원금 관리",
    icon: Landmark,
    description: "지역별 지원 단가, 신청 상태, 갱신 일정을 지점 운영과 함께 관리합니다.",
    listTitle: "정부지원금 운영판",
    listSubtitle: "지원금 반영, 갱신, 종료 예정 건을 분리해서 추적합니다.",
    searchPlaceholder: "지원금명, 지역, 대상 지점 검색...",
    tabs: [
      { label: "전체", value: "all" },
      { label: "반영 중", value: "active" },
      { label: "갱신 예정", value: "renewal" },
      { label: "종료 예정", value: "closing" },
    ],
    stats: [
      { icon: Landmark, value: 9, label: "적용 중 지원금", counter: "건" },
      { icon: Clock3, value: 4, label: "갱신 예정", counter: "건" },
      { icon: AlertTriangle, value: 2, label: "종료 임박", counter: "건", colorIndex: 1 },
      { icon: CheckCircle2, value: "31개", label: "연결 지점", counter: "곳", colorIndex: 2 },
    ],
    emptyMessage: "조건에 맞는 정부지원금 건이 없습니다.",
    detailEmptyMessage: "지원금 항목을 선택하면 반영 범위와 일정이 표시됩니다.",
    records: [
      {
        id: "subsidy-2026-standard",
        title: "2026 돌봄 바우처 단가 반영",
        subtitle: "전 지점 기본 단가표 업데이트",
        category: "active",
        statusLabel: "반영 중",
        statusVariant: "info",
        updatedAt: "9분 전",
        owner: "정책 운영 윤다은",
        summary: "올해 변경된 돌봄 바우처 단가를 전 지점 가격표와 계약 문구에 반영하는 작업입니다.",
        tags: ["전사 공통", "단가표", "계약 문구"],
        detailRows: [
          { label: "지원금명", value: "2026 돌봄 바우처" },
          { label: "적용 범위", value: "전 지점" },
          { label: "반영 상태", value: "가격표 90%" },
          { label: "최종 마감", value: "2026-03-20" },
        ],
        metrics: [
          { label: "적용 지점", value: "31곳", helper: "가격표 동기화 대상" },
          { label: "문서 반영", value: "24/31", helper: "계약 문구 교체 완료 기준" },
          { label: "검증 필요", value: "7곳", helper: "지역 예외 단가 존재" },
          { label: "진행률", value: "90%", helper: "배포 전 최종 검토 단계" },
        ],
        checklist: [
          "지역 예외 단가가 있는 지점을 먼저 분리 검증합니다.",
          "가격표와 메시지 템플릿의 금액 문구가 일치하는지 확인합니다.",
          "마감 전 샘플 계약서를 3종류 이상 재생성해 검증합니다.",
        ],
        notes: [
          "반영 완료 후 지점장에게 가격표 변경 요약을 발송합니다.",
          "계약 생성 히스토리에 단가 버전을 함께 남기는 것이 안전합니다.",
        ],
      },
      {
        id: "subsidy-incheon-renewal",
        title: "인천 지역 특화 지원금 갱신",
        subtitle: "2026년 2분기 연장 신청 준비",
        category: "renewal",
        statusLabel: "갱신 예정",
        statusVariant: "warning",
        updatedAt: "36분 전",
        owner: "정책 운영 윤다은",
        summary: "인천 지역 지점에서만 사용하는 특화 지원금의 신청 서류와 만료 일정을 정리하는 건입니다.",
        tags: ["인천", "갱신", "서류 준비"],
        detailRows: [
          { label: "지원금명", value: "인천 지역 특화 지원금" },
          { label: "대상 지점", value: "8곳" },
          { label: "만료 예정일", value: "2026-03-31" },
          { label: "서류 준비", value: "6/8 완료" },
        ],
        metrics: [
          { label: "잔여 기간", value: "19일", helper: "만료까지 남은 시간" },
          { label: "누락 서류", value: "2건", helper: "증빙자료 보완 필요" },
          { label: "영향 고객", value: "63명", helper: "갱신 실패 시 단가 영향" },
          { label: "우선도", value: "높음", helper: "만료 후 자동 종료 위험" },
        ],
        checklist: [
          "지점별 증빙자료 업로드 상태를 오늘 안에 확인합니다.",
          "갱신 실패 시 대체 단가 fallback이 있는지 점검합니다.",
          "만료 7일 전 자동 알림이 정상 예약되었는지 검증합니다.",
        ],
        notes: [
          "갱신 승인 전까지 계약 신규 생성에는 임시 안내 문구를 노출합니다.",
          "지역별 예외 단가는 승인 직후 자동 재계산하도록 연결합니다.",
        ],
      },
      {
        id: "subsidy-senior-care",
        title: "시니어 돌봄 보조금 종료 예정",
        subtitle: "대상 지점 운영 상품 전환 준비",
        category: "closing",
        statusLabel: "종료 예정",
        statusVariant: "destructive",
        updatedAt: "4시간 전",
        owner: "사업 운영 임지후",
        summary: "오는 분기 종료 예정인 보조금에 대해 지점별 상품 전환과 고객 안내를 준비해야 합니다.",
        tags: ["종료 예정", "상품 전환", "고객 안내"],
        detailRows: [
          { label: "지원금명", value: "시니어 돌봄 보조금" },
          { label: "종료일", value: "2026-04-01" },
          { label: "영향 지점", value: "3곳" },
          { label: "전환 계획", value: "검토 중" },
        ],
        metrics: [
          { label: "영향 고객", value: "21명", helper: "전환 안내 대상" },
          { label: "대체 상품", value: "2개", helper: "지역별 안내 필요" },
          { label: "남은 준비", value: "브리핑 1회", helper: "지점장 설명 필요" },
          { label: "리스크", value: "높음", helper: "가격 민감도 큰 고객 포함" },
        ],
        checklist: [
          "대체 상품 가격표와 문구 차이를 비교합니다.",
          "영향 고객군을 선별해 안내 일정을 세분화합니다.",
          "종료일 이후 잘못된 지원금 적용이 없도록 자동 검증을 추가합니다.",
        ],
        notes: [
          "종료 전 마지막 주에는 신규 계약 생성에 경고 배너를 띄웁니다.",
          "오너 승인 전에는 가격표 확정본을 외부에 노출하지 않습니다.",
        ],
      },
    ],
  },
  {
    id: "notifications",
    label: "알림 테스트",
    icon: Bell,
    description: "브라우저 푸시 알림과 발송 동작을 관리자 화면에서 직접 점검합니다.",
    listTitle: "알림 테스트",
    listSubtitle: "구독된 디바이스로 테스트 알림을 전송할 수 있어요",
    searchPlaceholder: "테스트 항목 검색...",
    stats: [
      { icon: Bell, value: 1, label: "테스트 도구", counter: "개" },
      { icon: CheckCircle2, value: "Push", label: "채널", colorIndex: 2 },
      { icon: Clock3, value: "실시간", label: "전송 방식", colorIndex: 1 },
      { icon: ShieldCheck, value: "Owner", label: "접근 권한" },
    ],
    emptyMessage: "사용 가능한 알림 테스트 항목이 없습니다.",
    detailEmptyMessage: "테스트 항목을 선택하면 실행 패널이 표시됩니다.",
    records: [
      {
        id: "notification-test-broadcast",
        title: "브라우저 알림 테스트",
        subtitle: "구독된 브라우저 디바이스 전체에 테스트 알림을 전송합니다.",
        listTitle: "브라우저 알림 테스트",
        listSubtitle: "실시간 브로드캐스트",
        listSummary: "현재 구독 중인 디바이스로 알림을 발송합니다.",
        listStatusLabel: "실행 가능",
        category: "notifications",
        statusLabel: "대기",
        statusVariant: "info",
        updatedAt: "2026. 03. 19.",
        owner: "시스템",
        summary: "푸시 알림 수신 여부와 브라우저 구독 상태를 빠르게 확인할 수 있는 관리자용 테스트 도구입니다.",
        tags: ["Push", "브로드캐스트"],
        detailRows: [
          { label: "대상", value: "현재 구독된 모든 디바이스" },
          { label: "권장 사용", value: "브라우저 알림 설정 직후 확인" },
        ],
      },
    ],
  },
] as const;

const SECTION_THEME_CLASSNAMES: Record<
  AdminSectionId,
  {
    accentSurface: string;
    accentIcon: string;
    itemActiveRing: string;
    itemHoverRing: string;
    tagSurface: string;
    noteSurface: string;
  }
> = {
  signups: {
    accentSurface: "border-amber-200/80 bg-gradient-to-br from-amber-50 via-white to-orange-50",
    accentIcon: "bg-amber-500/12 text-amber-600",
    itemActiveRing: "border-amber-300 bg-amber-50/70 shadow-[0_24px_40px_-30px_rgba(245,158,11,0.55)]",
    itemHoverRing: "hover:border-amber-200 hover:bg-amber-50/40",
    tagSurface: "bg-amber-100 text-amber-700",
    noteSurface: "bg-amber-50/70",
  },
  branches: {
    accentSurface: "border-emerald-200/80 bg-gradient-to-br from-emerald-50 via-white to-teal-50",
    accentIcon: "bg-emerald-500/12 text-emerald-600",
    itemActiveRing: "border-emerald-300 bg-emerald-50/70 shadow-[0_24px_40px_-30px_rgba(16,185,129,0.55)]",
    itemHoverRing: "hover:border-emerald-200 hover:bg-emerald-50/40",
    tagSurface: "bg-emerald-100 text-emerald-700",
    noteSurface: "bg-emerald-50/70",
  },
  accounts: {
    accentSurface: "border-sky-200/80 bg-gradient-to-br from-sky-50 via-white to-blue-50",
    accentIcon: "bg-sky-500/12 text-sky-700",
    itemActiveRing: "border-sky-300 bg-sky-50/70 shadow-[0_24px_40px_-30px_rgba(14,165,233,0.55)]",
    itemHoverRing: "hover:border-sky-200 hover:bg-sky-50/40",
    tagSurface: "bg-sky-100 text-sky-700",
    noteSurface: "bg-sky-50/70",
  },
  subsidies: {
    accentSurface: "border-cyan-200/80 bg-gradient-to-br from-cyan-50 via-white to-teal-50",
    accentIcon: "bg-cyan-500/12 text-cyan-700",
    itemActiveRing: "border-cyan-300 bg-cyan-50/70 shadow-[0_24px_40px_-30px_rgba(6,182,212,0.5)]",
    itemHoverRing: "hover:border-cyan-200 hover:bg-cyan-50/40",
    tagSurface: "bg-cyan-100 text-cyan-700",
    noteSurface: "bg-cyan-50/70",
  },
  notifications: {
    accentSurface: "border-indigo-200/80 bg-gradient-to-br from-indigo-50 via-white to-sky-50",
    accentIcon: "bg-indigo-500/12 text-indigo-700",
    itemActiveRing: "border-indigo-300 bg-indigo-50/70 shadow-[0_24px_40px_-30px_rgba(79,70,229,0.45)]",
    itemHoverRing: "hover:border-indigo-200 hover:bg-indigo-50/40",
    tagSurface: "bg-indigo-100 text-indigo-700",
    noteSurface: "bg-indigo-50/70",
  },
};

const STATUS_ICON: Record<StatusVariant, LucideIcon> = {
  warning: Clock3,
  info: ShieldCheck,
  success: CheckCircle2,
  destructive: AlertTriangle,
};

const CATEGORY_BADGE_STYLE: Record<string, { bg: string; text: string; icon?: string }> = {
  launch: { bg: "bg-v3-green-light", text: "text-v3-green" },
  messaging: { bg: "bg-v3-orange-light", text: "text-v3-orange" },
  alimtalk: { bg: "bg-v3-primary-light", text: "text-v3-primary" },
  notifications: { bg: "bg-indigo-100", text: "text-indigo-700", icon: "bg-indigo-500/12 text-indigo-700" },
  admin: { bg: "bg-v3-green-light", text: "text-v3-green", icon: "bg-emerald-500/12 text-emerald-600" },
  "branch-manager": { bg: "bg-amber-100", text: "text-amber-700", icon: "bg-amber-500/12 text-amber-600" },
  manager: { bg: "bg-sky-100", text: "text-sky-700", icon: "bg-sky-500/12 text-sky-700" },
};

const DEFAULT_BADGE_STYLE = { bg: "bg-v3-green-light", text: "text-v3-green" };

function filterSectionRecords(section: AdminSection, tab: string, query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  return section.records.filter((record) => {
    const matchesTab =
      tab === "all" ||
      record.category === tab ||
      (record.requests?.some((r) => r.category === tab) ?? false);

    if (!matchesTab) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    const searchPool = [
      record.title,
      record.subtitle,
      record.summary,
      record.owner,
      ...record.tags,
      ...record.detailRows.map((row) => row.value),
    ]
      .join(" ")
      .toLowerCase();

    return searchPool.includes(normalizedQuery);
  });
}

function createInitialViewState(): Record<AdminSectionId, SectionViewState> {
  return OWNER_ADMIN_SECTIONS.reduce((acc, section) => {
    acc[section.id] = {
      tab: "all",
      search: "",
      selectedRecordId: section.records[0]?.id ?? null,
    };

    return acc;
  }, {} as Record<AdminSectionId, SectionViewState>);
}

function resolveSelectedRecordId(
  section: AdminSection,
  nextTab: string,
  nextSearch: string,
  preferredSelectedRecordId: string | null
) {
  if (preferredSelectedRecordId === null) {
    return null;
  }

  const visibleRecords = filterSectionRecords(section, nextTab, nextSearch);

  if (visibleRecords.some((record) => record.id === preferredSelectedRecordId)) {
    return preferredSelectedRecordId;
  }

  return visibleRecords[0]?.id ?? null;
}

export function OwnerAdminConsole() {
  const [activeSectionId, setActiveSectionId] = useState<AdminSectionId>("signups");
  const [viewStateBySection, setViewStateBySection] = useState<Record<AdminSectionId, SectionViewState>>(
    createInitialViewState
  );

  const activeSection = useMemo(
    () => OWNER_ADMIN_SECTIONS.find((section) => section.id === activeSectionId) ?? OWNER_ADMIN_SECTIONS[0],
    [activeSectionId]
  );
  const activeViewState = viewStateBySection[activeSectionId];
  const deferredSearchQuery = useDeferredValue(activeViewState.search);

  const activeTheme = SECTION_THEME_CLASSNAMES[activeSection.id];
  const isApprovalSection = activeSection.id === "signups" || activeSection.id === "branches";

  const filteredRecords = useMemo(() => {
    return filterSectionRecords(activeSection, activeViewState.tab, deferredSearchQuery);
  }, [activeSection, activeViewState.tab, deferredSearchQuery]);

  const selectedRecord = useMemo(
    () => filteredRecords.find((record) => record.id === activeViewState.selectedRecordId) ?? null,
    [filteredRecords, activeViewState.selectedRecordId]
  );
  const showVoucherPriceUploadForm =
    activeSection.id === "subsidies" && selectedRecord?.id === "subsidy-2026-standard";

  const updateActiveSectionState = (updater: (current: SectionViewState) => SectionViewState) => {
    setViewStateBySection((prev) => ({
      ...prev,
      [activeSectionId]: updater(prev[activeSectionId]),
    }));
  };

  return (
    <PageSection name="system-admin">
      <StatsBar name="system-admin" items={PERSISTENT_SYSTEM_ADMIN_STATS} />

      <div className="flex flex-1 min-h-0 flex-col gap-6 lg:flex-row">
        <SectionNav
          items={OWNER_ADMIN_SECTIONS.map((section) => ({
            id: section.id,
            label: section.label,
            icon: section.icon,
            disabled: section.id === "subsidies",
          }))}
          activeId={activeSection.id}
          onSelect={(id) => setActiveSectionId(id as AdminSectionId)}
        />

        <div className="min-h-0 flex-1">
          <SplitLayout
            hasSelection={!!selectedRecord}
            onBack={() =>
              updateActiveSectionState((current) => ({
                ...current,
                selectedRecordId: null,
              }))
            }
          >
            <ListPanel
              title={activeSection.listTitle}
              subtitle={activeSection.listSubtitle}
              tabs={activeSection.tabs ? [...activeSection.tabs] : undefined}
              activeTab={activeSection.tabs ? activeViewState.tab : undefined}
              onTabChange={
                activeSection.tabs
                  ? (nextTab) =>
                      updateActiveSectionState((current) => ({
                        ...current,
                        tab: nextTab,
                        selectedRecordId: resolveSelectedRecordId(
                          activeSection,
                          nextTab,
                          current.search,
                          current.selectedRecordId
                        ),
                      }))
                  : undefined
              }
              searchValue={activeViewState.search}
              onSearchChange={(nextSearch) =>
                updateActiveSectionState((current) => ({
                  ...current,
                  search: nextSearch,
                  selectedRecordId: resolveSelectedRecordId(
                    activeSection,
                    current.tab,
                    nextSearch,
                    current.selectedRecordId
                  ),
                }))
              }
              searchPlaceholder={activeSection.searchPlaceholder}
            >
              {filteredRecords.length === 0 ? (
                <ListEmptyState
                  name="system-admin-list-empty"
                  icon={activeSection.icon}
                  message={activeSection.emptyMessage}
                />
              ) : (
                <div className="space-y-2 pb-4">
                  {filteredRecords.map((record, index) => {
                    const isActive = record.id === selectedRecord?.id;
                    const ListIcon = activeSection.id === "branches" ? Building2 : activeSection.id === "accounts" ? Users : STATUS_ICON[record.statusVariant];
                    const listPills = record.listBadgeLabel ? [record.listBadgeLabel] : record.tags;
                    const hasSingleAsidePill = listPills.length === 1;

                    return (
                      <button
                        key={record.id}
                        type="button"
                        data-component="system-admin-list-item"
                        onClick={() =>
                          updateActiveSectionState((current) => ({
                            ...current,
                            selectedRecordId: record.id,
                          }))
                        }
                        style={{ animationDelay: `${index * 0.04}s` }}
                        className={cn(
                          "animate-v3-pop-up w-full min-h-[76px] rounded-[18px] border-2 border-transparent bg-white p-4 text-left transition-all duration-200",
                          "hover:bg-v3-primary-light/50 hover:border-v3-primary/30",
                          isActive && "border-v3-primary bg-v3-primary-light"
                        )}
                      >
                        <div className="flex min-h-11 items-center gap-3">
                          <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]", CATEGORY_BADGE_STYLE[record.category]?.icon ?? activeTheme.accentIcon)}>
                            <ListIcon className="h-4 w-4" />
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[0.85rem] font-semibold text-v3-dark">
                              {record.listTitle ?? record.title}
                            </p>
                            {record.listSubtitle ? (
                              <p className="mt-0.5 truncate text-[0.7rem] text-v3-text-muted">
                                {record.listSubtitle}
                              </p>
                            ) : null}
                            <p className="mt-1.5 min-w-0 truncate text-[0.74rem] text-v3-text">
                              {record.listSummary ?? record.summary}
                            </p>
                            {!hasSingleAsidePill && listPills.length > 0 ? (
                              <div className="mt-2 flex flex-wrap items-center gap-1">
                                {listPills.map((tag) => (
                                  <TagPill
                                    key={tag}
                                    variant={getAdminTagPillVariant(activeSection.id)}
                                  >
                                    {tag}
                                  </TagPill>
                                ))}
                              </div>
                            ) : null}
                          </div>

                          {hasSingleAsidePill ? (
                            <div className="ml-auto flex shrink-0 items-center self-center">
                              <TagPill variant={getAdminTagPillVariant(activeSection.id)}>
                                {listPills[0]}
                              </TagPill>
                            </div>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </ListPanel>

            {selectedRecord ? (
              <DetailPanel
                avatar={(() => {
                  const iconStyle = CATEGORY_BADGE_STYLE[selectedRecord.category]?.icon;
                  return (
                    <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px]", iconStyle ?? "bg-v3-primary-light text-v3-primary")}>
                      <activeSection.icon className="h-5 w-5" />
                    </div>
                  );
                })()}
                title={selectedRecord.listTitle ?? selectedRecord.title}
                subtitle={
                  isApprovalSection ? (
                    <span className="text-sm text-v3-text-muted">
                      {activeSection.id === "signups"
                        ? "회원가입 신청 내역을 확인해 보세요."
                        : `${selectedRecord.listTitle ?? selectedRecord.title}의 승인 신청 내역을 확인해 보세요.`}
                    </span>
                  ) : selectedRecord.listSubtitle && selectedRecord.listStatusLabel ? (
                    <span className="flex items-center gap-3 text-sm text-v3-text-muted">
                      <span className="flex items-center gap-1">
                        <Building2 className="w-3.5 h-3.5" />
                        {selectedRecord.listSubtitle}
                      </span>
                      <span className="flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        {selectedRecord.listStatusLabel}
                      </span>
                    </span>
                  ) : (
                    <span className="text-sm text-v3-text-muted">
                      {activeSection.label} · {selectedRecord.owner}
                    </span>
                  )
                }
                trailing={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 rounded-full border-0 text-v3-text-muted hover:bg-v3-dim-white hover:text-v3-primary"
                        aria-label="더보기"
                      >
                        <EllipsisVertical className="h-5 w-5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem>역할 변경</DropdownMenuItem>
                      <DropdownMenuItem>계정 정보 수정</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive">계정 삭제</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              >
                <div className="space-y-5">
                  {(selectedRecord.requests && selectedRecord.requests.length > 0
                    ? selectedRecord.requests
                    : [{ category: selectedRecord.category, statusLabel: selectedRecord.statusLabel, detailRows: selectedRecord.detailRows, applicantRows: selectedRecord.applicantRows }]
                  ).map((req) => {
                    const infoTitle = activeSection.id === "signups" ? "회원가입 정보" : req.category === "launch" ? "지점 정보" : activeSection.id === "accounts" ? "계정 정보" : "신청 정보";
                    const showCardBadge = selectedRecord.requests && selectedRecord.requests.length > 1;
                    return (
                      <div
                        key={req.category}
                        className="rounded-[18px] border border-v3-border p-5 space-y-4"
                      >
                        {showCardBadge && (
                          <StatusPill variant={getAdminRequestPillVariant(req.category)} size="sm">
                            {req.statusLabel}
                          </StatusPill>
                        )}
                        {req.applicantRows && (
                          <InfoCard title="신청인 정보">
                            {req.applicantRows.map((row) => (
                              <InfoRow key={row.label} label={row.label} value={row.value} />
                            ))}
                          </InfoCard>
                        )}
                        <InfoCard title={infoTitle}>
                          {req.detailRows.map((row) => (
                            <InfoRow key={row.label} label={row.label} value={row.value} />
                          ))}
                        </InfoCard>
                        {activeSection.id !== "accounts" && (
                          <div className="flex flex-col gap-3 sm:flex-row">
                            <Button type="button" size="md" variant="positive" className="w-full sm:flex-1">
                              승인
                            </Button>
                            <Button type="button" size="md" variant="negative-outline" className="w-full sm:flex-1">
                              거부
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {activeSection.id === "notifications" ? (
                    <InfoCard title="알림 실행">
                      <NotificationTestSection />
                    </InfoCard>
                  ) : null}

                  {showVoucherPriceUploadForm ? (
                    <div data-component="system-admin-voucher-upload">
                      <VoucherPriceUploadForm />
                    </div>
                  ) : null}

                  {!isApprovalSection && selectedRecord.metrics?.length ? (
                    <>
                      <InfoCard title="핵심 메트릭">
                        <div className="grid gap-3 sm:grid-cols-2">
                          {selectedRecord.metrics.map((metric) => (
                            <div
                              key={metric.label}
                              data-component="system-admin-metric-card"
                              className="rounded-[16px] border border-white/80 bg-white/80 p-3"
                            >
                              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-v3-text-muted">
                                {metric.label}
                              </p>
                              <p className="mt-2 text-xl font-bold text-v3-dark">{metric.value}</p>
                              <p className="mt-1 text-[0.76rem] leading-5 text-v3-text-muted">
                                {metric.helper}
                              </p>
                            </div>
                          ))}
                        </div>
                      </InfoCard>

                      <InfoCard title="검토 체크리스트">
                        <div className="space-y-2">
                          {selectedRecord.checklist?.map((item) => (
                            <div
                              key={item}
                              data-component="system-admin-checklist-item"
                              className="flex items-start gap-3 rounded-[16px] border border-white/80 bg-white/80 p-3"
                            >
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                              <p className="text-[0.8rem] leading-5 text-v3-text">{item}</p>
                            </div>
                          ))}
                        </div>
                      </InfoCard>

                      <InfoCard title="다음 액션">
                        <div className="space-y-2">
                          {selectedRecord.notes?.map((note) => (
                            <div
                              key={note}
                              data-component="system-admin-next-action"
                              className={cn("flex items-start gap-3 rounded-[16px] p-3", activeTheme.noteSurface)}
                            >
                              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-v3-primary" />
                              <p className="text-[0.8rem] leading-5 text-v3-text">{note}</p>
                            </div>
                          ))}
                        </div>
                      </InfoCard>
                    </>
                  ) : null}
                </div>
              </DetailPanel>
            ) : (
              <DetailPanel
                avatar={
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary">
                    <activeSection.icon className="h-5 w-5" />
                  </div>
                }
                title={activeSection.listTitle}
                subtitle={activeSection.detailEmptyMessage}
                overlay={
                  <div data-component="system-admin-detail-empty" className="flex items-center justify-center flex-none min-h-0">
                    <div className="text-center text-v3-text-muted">
                      <activeSection.icon className="mx-auto mb-3 h-12 w-12 opacity-30" />
                      <p className="text-[0.85rem]">{activeSection.detailEmptyMessage}</p>
                    </div>
                  </div>
                }
              >
                {null}
              </DetailPanel>
            )}
          </SplitLayout>
        </div>
      </div>
    </PageSection>
  );
}
