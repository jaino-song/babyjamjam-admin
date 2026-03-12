"use client";

import { useDeferredValue, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock3,
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
  EmptyState,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AdminSectionId = "signups" | "branches" | "accounts" | "subsidies";
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

interface AdminRecord {
  id: string;
  title: string;
  subtitle: string;
  listTitle?: string;
  listSubtitle?: string;
  listSummary?: string;
  listBadgeLabel?: string;
  category: string;
  statusLabel: string;
  statusVariant: StatusVariant;
  updatedAt: string;
  owner: string;
  summary: string;
  tags: readonly string[];
  detailRows: readonly AdminDetailRow[];
  metrics: readonly AdminMetric[];
  checklist: readonly string[];
  notes: readonly string[];
}

interface AdminSection {
  id: AdminSectionId;
  label: string;
  icon: LucideIcon;
  description: string;
  listTitle: string;
  listSubtitle: string;
  searchPlaceholder: string;
  tabs?: readonly { label: string; value: string }[];
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

const PERSISTENT_SYSTEM_ADMIN_STATS: readonly StatsBarItem[] = [
  { icon: UserPlus, value: 1, label: "회원가입 신청", counter: "건" },
  { icon: MessageSquare, value: 1, label: "메시지 발송 기능 신청", counter: "건", colorIndex: 1 },
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
        updatedAt: "5분 전",
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
        updatedAt: "27분 전",
        owner: "운영팀 박진아",
        summary: "기존 기관에서 메시지 발송 기능 사용을 요청해 발신 프로필과 과금 정책 연결 여부를 확인해야 합니다.",
        tags: ["메시지 발송 기능 신청", "알림톡", "기존 기관"],
        detailRows: [
          { label: "신청 유형", value: "메시지 발송 기능 신청" },
          { label: "기관명", value: "노을 공동육아센터" },
          { label: "요청 기능", value: "알림톡 및 문자 발송" },
          { label: "발신 채널", value: "카카오 알림톡 + SMS" },
          { label: "쟁점", value: "발신 프로필 승인 필요" },
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
    listTitle: "지점 운영 보드",
    listSubtitle: "개설과 운영 상태, 점검 이슈를 동일한 흐름에서 다룹니다.",
    searchPlaceholder: "지점명, 지역, 담당자 검색...",
    tabs: [
      { label: "전체", value: "all" },
      { label: "개설 준비", value: "launch" },
      { label: "운영 중", value: "active" },
      { label: "점검 필요", value: "audit" },
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
        subtitle: "신규 지역 확장에 따른 운영 구조 생성",
        category: "launch",
        statusLabel: "개설 준비",
        statusVariant: "warning",
        updatedAt: "18분 전",
        owner: "지역 운영 리더 이현지",
        summary: "개설 전 직원 배정과 정부지원금 기본 단가 연결이 마지막 단계입니다.",
        tags: ["신규 지점", "송도", "오픈 D-4"],
        detailRows: [
          { label: "지점명", value: "송도 3호점" },
          { label: "지역", value: "인천 연수구" },
          { label: "오픈 일정", value: "2026-03-16" },
          { label: "책임자", value: "이현지" },
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
        title: "청라점 운영 안정화",
        subtitle: "이용자 증가에 따른 서비스 용량 점검",
        category: "active",
        statusLabel: "운영 중",
        statusVariant: "success",
        updatedAt: "1시간 전",
        owner: "지점장 강하늘",
        summary: "지난주 대비 신규 고객이 늘어 메시지/문서 사용량 상향 조정이 필요합니다.",
        tags: ["운영 중", "용량 점검", "이용자 증가"],
        detailRows: [
          { label: "지점명", value: "청라점" },
          { label: "활성 고객", value: "84명" },
          { label: "직원 수", value: "19명" },
          { label: "상태", value: "안정 운영" },
        ],
        metrics: [
          { label: "이번 주 계약", value: "16건", helper: "평균 대비 22% 증가" },
          { label: "문서 저장소", value: "71%", helper: "증설 전 알림 기준 도달" },
          { label: "알림 발송 성공률", value: "99.4%", helper: "알림톡/이메일 포함" },
          { label: "응답 지연", value: "정상", helper: "지점별 SLA 유지 중" },
        ],
        checklist: [
          "용량 확장 전 비용 영향도를 확인합니다.",
          "지점장 대시보드 권한이 최신 구조와 일치하는지 검토합니다.",
          "문서 보관 정책이 지점 계약 건수에 맞는지 확인합니다.",
        ],
        notes: [
          "다음 분기 확장 후보 지점으로 자동 태깅해 둡니다.",
          "고객 증가 추세가 유지되면 전담 매니저 추가 배정이 필요합니다.",
        ],
      },
      {
        id: "branch-bupyeong",
        title: "부평점 운영 점검",
        subtitle: "휴면 계정 증가와 발송 실패 비율 확인 필요",
        category: "audit",
        statusLabel: "점검 필요",
        statusVariant: "destructive",
        updatedAt: "3시간 전",
        owner: "품질 관리 민서현",
        summary: "최근 7일간 휴면 계정과 알림 실패율이 기준치를 넘겨 운영 점검 대상으로 분류되었습니다.",
        tags: ["점검", "휴면 계정", "알림 실패"],
        detailRows: [
          { label: "지점명", value: "부평점" },
          { label: "이슈 유형", value: "운영 품질 점검" },
          { label: "발생 기간", value: "최근 7일" },
          { label: "조치 우선순위", value: "높음" },
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
    ],
  },
  {
    id: "accounts",
    label: "계정 관리",
    icon: Users,
    description: "오너, 관리자, 매니저 계정의 역할과 보안 상태를 한 화면에서 검토합니다.",
    listTitle: "계정 권한 센터",
    listSubtitle: "민감 계정, 휴면 계정, 역할 변경 요청을 구분해서 관리합니다.",
    searchPlaceholder: "이름, 이메일, 조직, 역할 검색...",
    tabs: [
      { label: "전체", value: "all" },
      { label: "오너 계정", value: "owner" },
      { label: "관리자 권한", value: "admin" },
      { label: "보안 점검", value: "security" },
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
        subtitle: "결재선 변경에 따른 소유권 재배치",
        category: "owner",
        statusLabel: "권한 변경",
        statusVariant: "info",
        updatedAt: "11분 전",
        owner: "보안 담당 정민호",
        summary: "본사 owner 2명 체계에서 단일 승인 체계로 줄이기 위한 권한 조정 요청입니다.",
        tags: ["owner", "권한 재배치", "결재선 변경"],
        detailRows: [
          { label: "대상 계정", value: "hq-owner@agajamjam.kr" },
          { label: "현재 권한", value: "owner" },
          { label: "변경 예정", value: "admin" },
          { label: "승인 필요", value: "예" },
        ],
        metrics: [
          { label: "연결 조직", value: "4곳", helper: "복수 조직 소유권 포함" },
          { label: "최근 로그인", value: "오늘 08:31", helper: "최근 24시간 내 접속" },
          { label: "동시 owner", value: "2명", helper: "변경 후 1명 예정" },
          { label: "감사 로그", value: "정상", helper: "최근 30일 이상 징후 없음" },
        ],
        checklist: [
          "감사 로그 백업 후 owner 역할을 하향 조정합니다.",
          "다중 조직 소유권 매핑이 끊기지 않는지 확인합니다.",
          "변경 직후 조직 선택 UX를 다시 검증합니다.",
        ],
        notes: [
          "권한 변경은 야간 배치 직후에 처리하는 편이 안전합니다.",
          "하향 조정된 계정의 북마크 URL 접근도 함께 점검합니다.",
        ],
      },
      {
        id: "account-songdo-manager",
        title: "송도점 관리자 권한 부여",
        subtitle: "신규 지점 운영 준비에 따른 admin 승격",
        category: "admin",
        statusLabel: "승격 검토",
        statusVariant: "warning",
        updatedAt: "49분 전",
        owner: "지역 운영 리더 이현지",
        summary: "오픈 예정 지점의 총괄 담당자를 manager에서 admin으로 조정하는 요청입니다.",
        tags: ["admin", "승격", "신규 지점"],
        detailRows: [
          { label: "대상 계정", value: "songdo.lead@agajamjam.kr" },
          { label: "현재 권한", value: "manager" },
          { label: "요청 권한", value: "admin" },
          { label: "적용 지점", value: "송도 3호점" },
        ],
        metrics: [
          { label: "권한 범위", value: "지점 단위", helper: "전사 설정 접근 없음" },
          { label: "준비 완료율", value: "87%", helper: "지점 오픈 체크리스트 기준" },
          { label: "관련 계정", value: "8명", helper: "같은 지점 운영팀" },
          { label: "승인 우선도", value: "중간", helper: "오픈 D-4 기준" },
        ],
        checklist: [
          "지점 단위 문서 및 고객 권한만 부여되는지 확인합니다.",
          "오너 전용 메뉴 접근이 노출되지 않도록 재검증합니다.",
          "승격 사유와 책임 범위를 운영 문서에 남깁니다.",
        ],
        notes: [
          "승격 후 1주일 동안 민감 액션 로그를 별도 태깅합니다.",
          "필요 시 오픈 안정화 이후 다시 manager로 하향할 수 있습니다.",
        ],
      },
      {
        id: "account-bupyeong-security",
        title: "부평점 휴면 계정 잠금",
        subtitle: "미사용 계정과 장기 미인증 계정 동시 정리",
        category: "security",
        statusLabel: "보안 점검",
        statusVariant: "destructive",
        updatedAt: "2시간 전",
        owner: "품질 관리 민서현",
        summary: "장기 미사용 계정과 최근 인증 오류가 누적된 계정을 묶어 선제 잠금이 필요합니다.",
        tags: ["보안", "휴면 계정", "잠금 예정"],
        detailRows: [
          { label: "대상 그룹", value: "부평점 휴면 계정 11개" },
          { label: "위험 요소", value: "장기 미접속 + 인증 오류" },
          { label: "예상 영향", value: "지점 운영팀 3명" },
          { label: "권장 조치", value: "선잠금 후 재승인" },
        ],
        metrics: [
          { label: "휴면 기간", value: "60일+", helper: "정책 기준 초과" },
          { label: "인증 오류", value: "7회", helper: "최근 48시간 누적" },
          { label: "잠금 대상", value: "11개", helper: "일괄 처리 가능" },
          { label: "복구 방식", value: "오너 승인", helper: "관리자 임시 복구 차단" },
        ],
        checklist: [
          "잠금 전 필수 운영 계정이 포함되지 않았는지 확인합니다.",
          "재승인 프로세스 안내 메시지를 미리 준비합니다.",
          "동일 IP 반복 실패 여부를 별도 로깅에 남깁니다.",
        ],
        notes: [
          "보안 점검 섹션은 owner 또는 지정 보안 담당자만 리뷰합니다.",
          "잠금 후 24시간 안에 지점장에게 후속 조치 링크를 전달합니다.",
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
};

const STATUS_ICON: Record<StatusVariant, LucideIcon> = {
  warning: Clock3,
  info: ShieldCheck,
  success: CheckCircle2,
  destructive: AlertTriangle,
};

function filterSectionRecords(section: AdminSection, tab: string, query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  return section.records.filter((record) => {
    const matchesTab = tab === "all" || record.category === tab;

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
  const isSignupSection = activeSection.id === "signups";

  const filteredRecords = useMemo(() => {
    return filterSectionRecords(activeSection, activeViewState.tab, deferredSearchQuery);
  }, [activeSection, activeViewState.tab, deferredSearchQuery]);

  const selectedRecord = useMemo(
    () => filteredRecords.find((record) => record.id === activeViewState.selectedRecordId) ?? null,
    [filteredRecords, activeViewState.selectedRecordId]
  );

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
                <div className="space-y-3 pb-4">
                  {filteredRecords.map((record) => {
                    const isActive = record.id === selectedRecord?.id;
                    const StatusIcon = STATUS_ICON[record.statusVariant];

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
                        className={cn(
                          "w-full rounded-[14px] border-2 border-transparent bg-white p-3 text-left transition-all duration-200",
                          "hover:border-v3-border hover:bg-v3-dim-white/35",
                          isActive && "border-v3-primary/30 bg-white"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]", activeTheme.accentIcon)}>
                            <StatusIcon className="h-4 w-4" />
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-[0.85rem] font-semibold text-v3-dark">
                                  {record.listTitle ?? record.title}
                                </p>
                                <p className="mt-0.5 text-[0.7rem] text-v3-text-muted">
                                  {record.listSubtitle ?? record.subtitle}
                                </p>
                              </div>

                              <Badge variant={record.statusVariant} className="rounded-full px-2.5 py-1 text-[0.68rem]">
                                {record.statusLabel}
                              </Badge>
                            </div>

                            {(record.listBadgeLabel || record.tags.length > 0) ? (
                              <div className="mt-2 flex items-center justify-between gap-2">
                                <p className="min-w-0 truncate text-[0.74rem] text-v3-text">
                                  {record.listSummary ?? record.summary}
                                </p>
                                {(record.listBadgeLabel ? [record.listBadgeLabel] : record.tags).map((tag) => (
                                  <span
                                    key={tag}
                                    className={cn(
                                      "inline-flex shrink-0 rounded-full px-2.5 py-1 text-[0.68rem] font-medium",
                                      activeTheme.tagSurface
                                    )}
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </ListPanel>

            {selectedRecord ? (
              <DetailPanel
                title={selectedRecord.title}
                subtitle={
                  <span className="text-[0.8rem] text-v3-text-muted">
                    {activeSection.label} · {selectedRecord.owner}
                  </span>
                }
                badges={
                  <Badge variant={selectedRecord.statusVariant} className="rounded-full px-2.5 py-1 text-[0.68rem]">
                    {selectedRecord.statusLabel}
                  </Badge>
                }
              >
                <div className="space-y-5">
                  <InfoCard title={isSignupSection ? "회원가입 정보" : "운영 개요"}>
                    {selectedRecord.detailRows.map((row) => (
                      <InfoRow key={row.label} label={row.label} value={row.value} />
                    ))}
                  </InfoCard>

                  {isSignupSection ? (
                    <div
                      data-component="system-admin-signup-actions"
                      className="flex flex-col gap-3 sm:flex-row"
                    >
                      <Button
                        type="button"
                        size="md"
                        variant="positive"
                        data-component="system-admin-approve-button"
                        className="w-full sm:flex-1"
                      >
                        승인
                      </Button>
                      <Button
                        type="button"
                        size="md"
                        variant="negative-outline"
                        data-component="system-admin-reject-button"
                        className="w-full sm:flex-1"
                      >
                        거부
                      </Button>
                    </div>
                  ) : null}

                  {!isSignupSection ? (
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
                          {selectedRecord.checklist.map((item) => (
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
                          {selectedRecord.notes.map((note) => (
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
              <EmptyState
                name="system-admin-detail-empty"
                icon={activeSection.icon}
                message={activeSection.detailEmptyMessage}
              />
            )}
          </SplitLayout>
        </div>
      </div>
    </PageSection>
  );
}
