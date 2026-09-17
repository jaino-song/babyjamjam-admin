"use client";

import { REGISTERABLE_ROLE_OPTIONS } from "@babyjamjam/shared";
import {
  Building2,
  KeyRound,
  MessageCircle,
  Save,
  ShieldCheck,
  UserCheck,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";

import { MobileSectionNav } from "@/components/app/mobile-redesign/primitives";
import { SlidingCard } from "@/components/app/mobile-redesign/sliding-card";
import { PolicyInfoRows } from "@/components/app/mobile-redesign/settings/PolicyInfoRows";
import {
  SettingsListCard,
  SettingsListItem,
  SettingsListRowsSkeleton,
} from "@/components/app/mobile-redesign/settings/SettingsListCard";
import { StatusPill } from "@/components/app/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  approveSystemAdminMessageSenderApproval,
  approveSystemAdminUser,
  createSystemAdminBranch,
  getSystemAdminBranchRequests,
  getSystemAdminUsers,
  rejectSystemAdminUser,
  updateSystemAdminBranch,
  updateSystemAdminUserAccount,
  type SystemAdminBranchInput,
  type SystemAdminBranchRequest,
  type SystemAdminUser,
} from "@/lib/api/system-admin";
import { useToast } from "@/hooks/use-toast";

import "@/components/app/mobile-redesign/redesign.css";

const PAGE_BASE = "mobile_system-admin_page";
const SLIDING_BASE = `${PAGE_BASE}_screen_content_sliding-card`;
const LIST_BASE = `${SLIDING_BASE}_stage_list-pane_admin-list`;
const DETAIL_BASE = `${SLIDING_BASE}_stage_detail-pane_body`;
const NEW_BRANCH_ID = "new-branch";

type SectionId = "branches" | "accounts";
type EditableRole = "admin" | "manager" | "user";

function isEditableRole(role: string | null | undefined): role is EditableRole {
  return role === "admin" || role === "manager" || role === "user";
}

const SECTION_NAV: readonly { id: SectionId; label: string; icon: LucideIcon }[] = [
  { id: "branches", label: "지점 관리", icon: Building2 },
  { id: "accounts", label: "계정 관리", icon: KeyRound },
];

const ROLE_LABELS: Record<string, string> = {
  owner: "오너",
  admin: "지점장",
  manager: "매니저",
  user: "직원",
};

const DEFAULT_BRANCH_FORM: SystemAdminBranchInput = {
  name: "",
  slug: "",
  ownerId: null,
  region: "",
  district: "",
  address: "",
  phone: "",
  email: "",
  isActive: true,
};

export function normalizeSystemAdminBranchInput(
  input: SystemAdminBranchInput,
): SystemAdminBranchInput {
  const email = input.email?.trim();
  if (email) return { ...input, email };

  const inputWithoutEmail = { ...input };
  delete inputWithoutEmail.email;
  return inputWithoutEmail;
}

function roleLabel(role: string | null | undefined): string {
  return ROLE_LABELS[role ?? ""] ?? "미지정";
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function locationLabel(branch: SystemAdminBranchRequest): string {
  return [branch.region, branch.district].filter(Boolean).join(" ") || branch.address || branch.slug;
}

function approvalLabel(status: string | null | undefined): { label: string; variant: "warning" | "success" | "info" } {
  if (status === "pending") return { label: "메시지 신청", variant: "warning" };
  if (status === "approved") return { label: "승인 완료", variant: "success" };
  return { label: "미신청", variant: "info" };
}

function accountStatus(user: SystemAdminUser): { label: string; variant: "warning" | "info" | "success" } {
  if (user.approvalStatus === "pending") return { label: "가입 대기", variant: "warning" };
  if (!user.phone || !user.birthDate) return { label: "추가 정보 필요", variant: "warning" };
  if (user.email && user.authProvider !== "kakao" && !user.emailVerified) {
    return { label: "이메일 인증 필요", variant: "info" };
  }
  return { label: "정상", variant: "success" };
}

function branchRows(branches: readonly SystemAdminBranchRequest[]) {
  return [
    { id: "all", label: "전체 지점", count: branches.length },
    {
      id: "messaging",
      label: "메시지 신청",
      count: branches.filter((branch) => branch.messageSenderApproval.approvalStatus === "pending").length,
    },
    {
      id: "approved",
      label: "승인 완료",
      count: branches.filter((branch) => branch.messageSenderApproval.approvalStatus === "approved").length,
    },
    {
      id: "not_requested",
      label: "미신청",
      count: branches.filter((branch) => !["pending", "approved"].includes(branch.messageSenderApproval.approvalStatus)).length,
    },
  ];
}

function accountRows(users: readonly SystemAdminUser[]) {
  return [
    { id: "all", label: "전체", count: users.length },
    { id: "pending", label: "가입 대기", count: users.filter((user) => user.approvalStatus === "pending").length },
    { id: "admin", label: "지점장", count: users.filter((user) => user.role === "admin").length },
    { id: "manager", label: "매니저", count: users.filter((user) => user.role === "manager").length },
    { id: "user", label: "직원", count: users.filter((user) => user.role === "user").length },
    { id: "owner", label: "오너", count: users.filter((user) => user.role === "owner").length },
  ];
}

function stopRowClick(event: React.SyntheticEvent): void {
  event.stopPropagation();
}

function StatusControl({
  "data-component": dataComponent,
  label,
  variant,
}: {
  "data-component": string;
  label: string;
  variant: "warning" | "success" | "info";
}): ReactElement {
  return (
    <span onClick={stopRowClick} onPointerDown={stopRowClick}>
      <StatusPill
        data-component={dataComponent}
        variant={variant}
        className="!rounded-[calc(999px*var(--glint-ui-scale,1))] !px-[calc(8px*var(--glint-ui-scale,1))] !py-[calc(4px*var(--glint-ui-scale,1))] !text-[calc(0.62rem*var(--glint-ui-scale,1))]"
      >
        {label}
      </StatusPill>
    </span>
  );
}

function DetailContent({
  "data-component": dataComponent,
  icon: Icon,
  title,
  description,
  children,
}: {
  "data-component": string;
  icon: React.ComponentType<LucideProps>;
  title: string;
  description: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div
      data-component={dataComponent}
      data-source-component="DetailContent"
      className="flex flex-col gap-[calc(18px*var(--glint-ui-scale,1))]"
    >
      <section
        data-component={`${dataComponent}_hero`}
        className="flex items-center gap-[calc(12px*var(--glint-ui-scale,1))]"
      >
        <span
          data-component={`${dataComponent}_hero_icon`}
          className="flex h-[calc(46px*var(--glint-ui-scale,1))] w-[calc(46px*var(--glint-ui-scale,1))] shrink-0 items-center justify-center rounded-[calc(14px*var(--glint-ui-scale,1))] bg-v3-primary-light text-v3-primary"
          aria-hidden="true"
        >
          <Icon
            className="h-[calc(20px*var(--glint-ui-scale,1))] w-[calc(20px*var(--glint-ui-scale,1))]"
            strokeWidth={2.25}
          />
        </span>
        <span
          data-component={`${dataComponent}_hero_copy`}
          className="flex min-w-0 flex-1 flex-col gap-[calc(4px*var(--glint-ui-scale,1))]"
        >
          <h2
            data-component={`${dataComponent}_hero_copy_title`}
            className="text-[calc(0.94rem*var(--glint-ui-scale,1))] font-bold leading-[calc(1.25rem*var(--glint-ui-scale,1))] text-v3-dark"
          >
            {title}
          </h2>
          <p
            data-component={`${dataComponent}_hero_copy_description`}
            className="text-[calc(0.7rem*var(--glint-ui-scale,1))] leading-[calc(1.05rem*var(--glint-ui-scale,1))] text-v3-text-muted"
          >
            {description}
          </p>
        </span>
      </section>
      {children}
    </div>
  );
}

function FormField({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}): ReactElement {
  return (
    <label data-component={`${id}_field`} className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-[calc(0.7rem*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted">
        {label}
      </Label>
      <Input
        id={id}
        variant="v3"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        data-component={`${id}_input`}
      />
    </label>
  );
}

function BranchForm({
  initial,
  managers,
  isSaving,
  onSave,
}: {
  initial: SystemAdminBranchInput;
  managers: readonly { id: string; label: string }[];
  isSaving: boolean;
  onSave: (value: SystemAdminBranchInput) => void;
}): ReactElement {
  const [form, setForm] = useState<SystemAdminBranchInput>(initial);
  const update = <K extends keyof SystemAdminBranchInput>(key: K, value: SystemAdminBranchInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };
  const canSave = form.name.trim().length > 0 && form.slug.trim().length > 0;

  return (
    <div data-component="mobile_system-admin_branch-form" className="flex flex-col gap-[calc(16px*var(--glint-ui-scale,1))]">
      <div className="grid grid-cols-2 gap-[calc(10px*var(--glint-ui-scale,1))]">
        <FormField id="system-admin-branch-name" label="지점명" value={form.name} onChange={(value) => update("name", value)} placeholder="예: 강남점" />
        <FormField id="system-admin-branch-slug" label="식별자" value={form.slug} onChange={(value) => update("slug", value)} placeholder="gangnam" />
      </div>
      <div className="grid grid-cols-2 gap-[calc(10px*var(--glint-ui-scale,1))]">
        <FormField id="system-admin-branch-region" label="시·도" value={form.region ?? ""} onChange={(value) => update("region", value)} placeholder="서울" />
        <FormField id="system-admin-branch-district" label="구·군" value={form.district ?? ""} onChange={(value) => update("district", value)} placeholder="강남구" />
      </div>
      <FormField id="system-admin-branch-address" label="주소" value={form.address ?? ""} onChange={(value) => update("address", value)} placeholder="지점 주소" />
      <div className="grid grid-cols-2 gap-[calc(10px*var(--glint-ui-scale,1))]">
        <FormField id="system-admin-branch-phone" label="대표 전화" value={form.phone ?? ""} onChange={(value) => update("phone", value)} placeholder="02-0000-0000" />
        <FormField id="system-admin-branch-email" label="이메일" value={form.email ?? ""} onChange={(value) => update("email", value)} placeholder="branch@example.com" type="email" />
      </div>
      <div data-component="mobile_system-admin_branch-form_owner-field" className="flex flex-col gap-1.5">
        <Label htmlFor="system-admin-branch-owner" className="text-[calc(0.7rem*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted">지점장</Label>
        <Select value={form.ownerId ?? "none"} onValueChange={(value) => update("ownerId", value === "none" ? null : value)}>
          <SelectTrigger id="system-admin-branch-owner" data-component="mobile_system-admin_branch-form_owner-select" className="h-[44px] w-full rounded-[12px] border-[1.5px] border-input bg-white text-[0.9rem]">
            <SelectValue placeholder="지점장 선택" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">지점장 미지정</SelectItem>
            {managers.map((manager) => <SelectItem key={manager.id} value={manager.id}>{manager.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between rounded-[calc(14px*var(--glint-ui-scale,1))] bg-v3-dim-white px-[calc(12px*var(--glint-ui-scale,1))] py-[calc(10px*var(--glint-ui-scale,1))]">
        <span className="flex flex-col gap-0.5">
          <Label htmlFor="system-admin-branch-active" className="text-[calc(0.75rem*var(--glint-ui-scale,1))] font-semibold text-v3-dark">운영 중</Label>
          <span className="text-[calc(0.66rem*var(--glint-ui-scale,1))] text-v3-text-muted">비활성 지점은 운영 목록에서 숨겨집니다.</span>
        </span>
        <Switch id="system-admin-branch-active" checked={form.isActive} onCheckedChange={(value) => update("isActive", value)} className="[--v3-ui-scale:var(--glint-ui-scale,1)]" />
      </div>
      <Button
        type="button"
        variant="v3"
        size="lg"
        width="lg"
        className="mt-1"
        disabled={!canSave || isSaving}
        onClick={() => onSave(normalizeSystemAdminBranchInput({ ...form, name: form.name.trim(), slug: form.slug.trim() }))}
        data-component="mobile_system-admin_branch-form_save"
      >
        <Save className="h-4 w-4" />
        {isSaving ? "저장 중…" : "지점 저장"}
      </Button>
    </div>
  );
}

function AccountAssignmentForm({
  branches,
  role,
  selectedBranchIds,
  isSaving,
  onRoleChange,
  onBranchToggle,
  onSave,
}: {
  branches: readonly SystemAdminBranchRequest[];
  role: EditableRole;
  selectedBranchIds: readonly string[];
  isSaving: boolean;
  onRoleChange: (role: EditableRole) => void;
  onBranchToggle: (branchId: string, checked: boolean) => void;
  onSave: () => void;
}): ReactElement {
  return (
    <div data-component="mobile_system-admin_account-assignment" className="flex flex-col gap-[calc(14px*var(--glint-ui-scale,1))]">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mobile-system-admin-account-role" className="text-[calc(0.7rem*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted">역할</Label>
        <Select value={role} onValueChange={(value) => onRoleChange(value as EditableRole)}>
          <SelectTrigger id="mobile-system-admin-account-role" data-component="mobile_system-admin_account-assignment_role" className="h-[44px] w-full rounded-[12px] border-[1.5px] border-input bg-white text-[0.9rem]"><SelectValue /></SelectTrigger>
          <SelectContent>{REGISTERABLE_ROLE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label className="text-[calc(0.7rem*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted">소속 지점</Label>
        <div className="flex flex-col gap-2 rounded-[calc(14px*var(--glint-ui-scale,1))] bg-v3-dim-white p-[calc(12px*var(--glint-ui-scale,1))]">
          {branches.filter((branch) => branch.isActive).map((branch) => (
            <label key={branch.id} className="flex items-center gap-2 text-[calc(0.74rem*var(--glint-ui-scale,1))] text-v3-dark">
              <Checkbox checked={selectedBranchIds.includes(branch.id)} onCheckedChange={(checked) => onBranchToggle(branch.id, checked === true)} data-component={`mobile_system-admin_account-assignment_branch-${branch.id}`} />
              <span className="min-w-0 flex-1 truncate">{branch.name}</span>
            </label>
          ))}
          {branches.filter((branch) => branch.isActive).length === 0 ? <span className="text-[calc(0.7rem*var(--glint-ui-scale,1))] text-v3-text-muted">활성 지점이 없습니다.</span> : null}
        </div>
      </div>
      <Button type="button" variant="v3" size="lg" width="lg" disabled={isSaving || selectedBranchIds.length === 0} onClick={onSave} data-component="mobile_system-admin_account-assignment_save">
        <Save className="h-4 w-4" />
        {isSaving ? "저장 중…" : "계정 정보 저장"}
      </Button>
    </div>
  );
}

export function SystemAdminPage(): ReactElement {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const didPushDetailRef = useRef(false);
  const sectionParam = params.get("section");
  const itemParam = params.get("item");
  const activeSection: SectionId = sectionParam === "accounts" ? "accounts" : "branches";
  const [branchFilter, setBranchFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [accountSearch, setAccountSearch] = useState("");
  const [branchSearch, setBranchSearch] = useState("");
  const [pendingRoles, setPendingRoles] = useState<Record<string, EditableRole>>({});
  const [pendingBranches, setPendingBranches] = useState<Record<string, string>>({});
  const [pendingOwnerBranches, setPendingOwnerBranches] = useState<Record<string, string>>({});
  const [accountEditRoles, setAccountEditRoles] = useState<Record<string, EditableRole>>({});
  const [accountEditBranches, setAccountEditBranches] = useState<Record<string, string[]>>({});

  const branchesQuery = useQuery({ queryKey: ["systemAdminBranchRequests"], queryFn: getSystemAdminBranchRequests });
  const usersQuery = useQuery({ queryKey: ["systemAdminUsers"], queryFn: getSystemAdminUsers });
  const branches = useMemo(() => branchesQuery.data ?? [], [branchesQuery.data]);
  const users = useMemo(() => usersQuery.data ?? [], [usersQuery.data]);
  const activeBranches = useMemo(() => branches.filter((branch) => branch.isActive), [branches]);
  const managerOptions = useMemo(
    () => users.filter((user) => user.approvalStatus === "approved").map((user) => ({ id: user.id, label: `${user.name ?? user.email ?? "이름 미등록"}${user.email ? ` (${user.email})` : ""}` })),
    [users],
  );
  const branchOwnerFreeOptions = useMemo(() => activeBranches.filter((branch) => branch.owner === null), [activeBranches]);

  const approveSenderMutation = useMutation({
    mutationFn: approveSystemAdminMessageSenderApproval,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["systemAdminBranchRequests"] });
      toast({ variant: "success", description: "메시지 발신번호 신청을 승인했어요" });
    },
    onError: () => toast({ variant: "destructive", description: "메시지 신청 승인에 실패했어요" }),
  });
  const createBranchMutation = useMutation({
    mutationFn: createSystemAdminBranch,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["systemAdminBranchRequests"] });
      toast({ variant: "success", description: "지점을 저장했어요" });
    },
    onError: () => toast({ variant: "destructive", description: "지점 저장에 실패했어요" }),
  });
  const updateBranchMutation = useMutation({
    mutationFn: ({ branchId, input }: { branchId: string; input: SystemAdminBranchInput }) => updateSystemAdminBranch(branchId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["systemAdminBranchRequests"] });
      toast({ variant: "success", description: "지점을 수정했어요" });
    },
    onError: () => toast({ variant: "destructive", description: "지점 수정에 실패했어요" }),
  });
  const approveUserMutation = useMutation({
    mutationFn: ({ id, role, branchId, ownerBranchId }: { id: string; role: EditableRole; branchId: string; ownerBranchId?: string }) => approveSystemAdminUser(id, role, branchId, ownerBranchId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["systemAdminUsers"] });
      toast({ variant: "success", description: "가입 승인을 처리했어요" });
    },
    onError: () => toast({ variant: "destructive", description: "가입 승인에 실패했어요" }),
  });
  const rejectUserMutation = useMutation({
    mutationFn: rejectSystemAdminUser,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["systemAdminUsers"] });
      toast({ variant: "success", description: "가입 신청을 반려했어요" });
    },
    onError: () => toast({ variant: "destructive", description: "가입 신청 반려에 실패했어요" }),
  });
  const updateAccountMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateSystemAdminUserAccount>[1] }) => updateSystemAdminUserAccount(id, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["systemAdminUsers"] });
      await queryClient.invalidateQueries({ queryKey: ["systemAdminBranchRequests"] });
      toast({ variant: "success", description: "계정 소속을 저장했어요" });
    },
    onError: (error) => {
      const status = (error as { response?: { status?: number } }).response?.status;
      toast({ variant: "destructive", description: status === 409 ? "다른 곳에서 변경된 계정입니다. 새로고침 후 다시 시도해 주세요." : "계정 수정에 실패했어요" });
    },
  });

  useEffect(() => {
    if (sectionParam !== "branches" && sectionParam !== "accounts") {
      router.replace("/system-admin?section=branches", { scroll: false });
    }
  }, [router, sectionParam]);

  const openItem = (id: string) => {
    router.push(`/system-admin?section=${activeSection}&item=${encodeURIComponent(id)}`, { scroll: false });
    didPushDetailRef.current = true;
  };
  const closeDetail = () => {
    if (didPushDetailRef.current) router.back();
    else router.replace(`/system-admin?section=${activeSection}`, { scroll: false });
  };
  const openSection = (id: SectionId) => {
    router.push(`/system-admin?section=${id}`, { scroll: false });
  };
  const openCreateBranch = () => {
    openItem(NEW_BRANCH_ID);
  };

  const filteredBranches = useMemo(() => branches.filter((branch) => {
    const approval = branch.messageSenderApproval.approvalStatus;
    const matchesFilter = branchFilter === "all" || (branchFilter === "messaging" && approval === "pending") || (branchFilter === "approved" && approval === "approved") || (branchFilter === "not_requested" && !["pending", "approved"].includes(approval));
    const query = branchSearch.trim().toLowerCase();
    return matchesFilter && (!query || [branch.name, branch.slug, branch.region, branch.district, branch.address, branch.owner?.name, branch.owner?.email].some((value) => value?.toLowerCase().includes(query)));
  }), [branchFilter, branchSearch, branches]);
  const filteredUsers = useMemo(() => users.filter((user) => {
    const category = user.approvalStatus === "pending" ? "pending" : user.role ?? "user";
    const query = accountSearch.trim().toLowerCase();
    return (accountFilter === "all" || accountFilter === category) && (!query || [user.name, user.email, user.phone, user.role, ...user.branches.map((branch) => branch.name)].some((value) => value?.toLowerCase().includes(query)));
  }), [accountFilter, accountSearch, users]);
  const isOpen = itemParam !== null && (itemParam === NEW_BRANCH_ID || (activeSection === "branches" ? filteredBranches.some((branch) => branch.id === itemParam) : filteredUsers.some((user) => user.id === itemParam)));
  const selectedBranch = branches.find((branch) => branch.id === itemParam) ?? null;
  const selectedUser = users.find((user) => user.id === itemParam) ?? null;

  const list = activeSection === "branches" ? (
    <SettingsListCard
      data-component={LIST_BASE}
      title="지점 관리"
      count={filteredBranches.length}
      subtitle="지점 운영 정보와 메시지 발신번호 신청을 관리할 수 있어요"
      actionLabel="지점 추가"
      onAction={openCreateBranch}
    >
      <div className="flex flex-col gap-2">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {branchRows(branches).map((filter) => <Button key={filter.id} type="button" variant={branchFilter === filter.id ? "v3-soft" : "ghost"} size="sm" className="h-8 shrink-0 rounded-full px-3 text-[0.68rem]" onClick={() => setBranchFilter(filter.id)}>{filter.label} {filter.count}</Button>)}
        </div>
        <Input variant="v3" value={branchSearch} onChange={(event) => setBranchSearch(event.target.value)} placeholder="지점명, 지역, 담당자 검색" aria-label="지점 검색" data-component={`${LIST_BASE}_search`} />
      </div>
      {branchesQuery.isLoading ? <SettingsListRowsSkeleton data-component={`${LIST_BASE}_loading`} rowCount={5} /> : filteredBranches.map((branch) => {
        const status = approvalLabel(branch.messageSenderApproval.approvalStatus);
        return <SettingsListItem key={branch.id} data-component={`${LIST_BASE}_item-${branch.id}`} icon={Building2} title={branch.name} subtitle={`${locationLabel(branch)} · ${branch.isActive ? "운영 중" : "비활성"}`} isSelected={itemParam === branch.id} onSelect={() => openItem(branch.id)} control={<StatusControl data-component={`${LIST_BASE}_item-${branch.id}_status`} label={status.label} variant={status.variant} />} />;
      })}
      {!branchesQuery.isLoading && filteredBranches.length === 0 ? <p data-component={`${LIST_BASE}_empty`} className="py-10 text-center text-[calc(0.72rem*var(--glint-ui-scale,1))] text-v3-text-muted">{branchesQuery.isError ? "지점 정보를 불러오지 못했습니다." : "조건에 맞는 지점이 없습니다."}</p> : null}
      {branchesQuery.isError ? <Button type="button" variant="outline" size="sm" onClick={() => void branchesQuery.refetch()} data-component={`${LIST_BASE}_retry`}>다시 시도</Button> : null}
    </SettingsListCard>
  ) : (
    <SettingsListCard data-component={LIST_BASE} title="계정 관리" count={filteredUsers.length} subtitle="등록된 계정과 소속, 권한을 확인할 수 있어요">
      <div className="flex flex-col gap-2">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">{accountRows(users).map((filter) => <Button key={filter.id} type="button" variant={accountFilter === filter.id ? "v3-soft" : "ghost"} size="sm" className="h-8 shrink-0 rounded-full px-3 text-[0.68rem]" onClick={() => setAccountFilter(filter.id)}>{filter.label} {filter.count}</Button>)}</div>
        <Input variant="v3" value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} placeholder="이름, 이메일, 지점 검색" aria-label="계정 검색" data-component={`${LIST_BASE}_search`} />
      </div>
      {usersQuery.isLoading ? <SettingsListRowsSkeleton data-component={`${LIST_BASE}_loading`} rowCount={5} /> : filteredUsers.map((user) => {
        const status = accountStatus(user);
        return <SettingsListItem key={user.id} data-component={`${LIST_BASE}_item-${user.id}`} icon={user.role === "owner" ? ShieldCheck : UserCheck} title={user.name ?? user.email ?? "이름 미등록"} subtitle={`${roleLabel(user.approvalStatus === "pending" ? user.requestedRole : user.role)} · ${user.branches.map((branch) => branch.name).join(", ") || (user.role === "owner" ? "오너 전용" : "소속 없음")}`} isSelected={itemParam === user.id} onSelect={() => openItem(user.id)} control={<StatusControl data-component={`${LIST_BASE}_item-${user.id}_status`} label={status.label} variant={status.variant} />} />;
      })}
      {!usersQuery.isLoading && filteredUsers.length === 0 ? <p data-component={`${LIST_BASE}_empty`} className="py-10 text-center text-[calc(0.72rem*var(--glint-ui-scale,1))] text-v3-text-muted">{usersQuery.isError ? "계정 정보를 불러오지 못했습니다." : "조건에 맞는 계정이 없습니다."}</p> : null}
      {usersQuery.isError ? <Button type="button" variant="outline" size="sm" onClick={() => void usersQuery.refetch()} data-component={`${LIST_BASE}_retry`}>다시 시도</Button> : null}
    </SettingsListCard>
  );

  let detail: ReactNode = null;
  let detailStatus: { label: string; variant: "warning" | "success" | "info" } | null = null;
  if (activeSection === "branches" && (itemParam === NEW_BRANCH_ID || selectedBranch)) {
    const branchInput: SystemAdminBranchInput = selectedBranch ? { name: selectedBranch.name, slug: selectedBranch.slug, ownerId: selectedBranch.owner?.id ?? null, region: selectedBranch.region ?? "", district: selectedBranch.district ?? "", address: selectedBranch.address ?? "", phone: selectedBranch.phone ?? "", email: selectedBranch.email ?? "", isActive: selectedBranch.isActive } : DEFAULT_BRANCH_FORM;
    detailStatus = itemParam === NEW_BRANCH_ID ? { label: "새 지점", variant: "info" } : approvalLabel(selectedBranch?.messageSenderApproval.approvalStatus);
    detail = <DetailContent data-component={`${DETAIL_BASE}_branch`} icon={Building2} title={itemParam === NEW_BRANCH_ID ? "지점 추가" : selectedBranch?.name ?? "지점 관리"} description="지점 운영 정보와 메시지 발신번호 상태를 관리합니다.">
      {selectedBranch && selectedBranch.messageSenderApproval.approvalStatus === "pending" ? <section data-component={`${DETAIL_BASE}_branch_sender-approval`} className="flex flex-col gap-3 rounded-[calc(18px*var(--glint-ui-scale,1))] border border-amber-200 bg-amber-50 p-4"><div className="flex items-center gap-2"><MessageCircle className="h-4 w-4 text-amber-700" /><strong className="text-[calc(0.8rem*var(--glint-ui-scale,1))] text-amber-900">메시지 발신번호 승인 신청</strong></div><PolicyInfoRows data-component={`${DETAIL_BASE}_branch_sender-approval_info`} title="신청 정보" rows={[{ id: "requester", label: "신청자", value: selectedBranch.messageSenderApproval.requestedBy?.name ?? "-" }, { id: "requested-at", label: "신청일", value: dateLabel(selectedBranch.messageSenderApproval.requestedAt) }, { id: "purpose", label: "요청 기능", value: "SMS/LMS 발송" }]} /><Button type="button" variant="v3" size="md" width="lg" disabled={approveSenderMutation.isPending} onClick={() => approveSenderMutation.mutate(selectedBranch.id)} data-component={`${DETAIL_BASE}_branch_sender-approval_approve`}>{approveSenderMutation.isPending ? "승인 중…" : "메시지 신청 승인"}</Button></section> : null}
      <BranchForm key={`branch-form-${itemParam ?? "new"}`} initial={branchInput} managers={managerOptions} isSaving={createBranchMutation.isPending || updateBranchMutation.isPending} onSave={(input) => itemParam === NEW_BRANCH_ID ? createBranchMutation.mutate(input) : selectedBranch ? updateBranchMutation.mutate({ branchId: selectedBranch.id, input }) : undefined} />
      {selectedBranch ? <PolicyInfoRows data-component={`${DETAIL_BASE}_branch_info`} title="운영 정보" rows={[{ id: "location", label: "지역", value: locationLabel(selectedBranch) }, { id: "owner", label: "지점장", value: selectedBranch.owner?.name ?? selectedBranch.owner?.email ?? "미지정" }, { id: "updated", label: "수정일", value: dateLabel(selectedBranch.updatedAt) }, { id: "sender-status", label: "발신번호", value: approvalLabel(selectedBranch.messageSenderApproval.approvalStatus).label }]} /> : null}
    </DetailContent>;
  } else if (activeSection === "accounts" && selectedUser) {
    const status = accountStatus(selectedUser);
    detailStatus = status;
    const isPending = selectedUser.approvalStatus === "pending";
    const selectedRole = pendingRoles[selectedUser.id] ?? ((selectedUser.requestedRole as EditableRole | null) ?? "user");
    const selectedBranchId = pendingBranches[selectedUser.id] ?? selectedUser.branches[0]?.id ?? activeBranches[0]?.id ?? "";
    const selectedOwnerBranchId = pendingOwnerBranches[selectedUser.id] ?? branchOwnerFreeOptions[0]?.id ?? "";
    const currentRole = accountEditRoles[selectedUser.id] ?? (isEditableRole(selectedUser.role) ? selectedUser.role : "user");
    const currentBranchIds = accountEditBranches[selectedUser.id] ?? selectedUser.branches.map((branch) => branch.id);
    const approvedNonOwner = !isPending && isEditableRole(selectedUser.role);
    detail = <DetailContent data-component={`${DETAIL_BASE}_account-${selectedUser.id}`} icon={selectedUser.role === "owner" ? ShieldCheck : KeyRound} title={isPending ? "가입 승인 대기" : `${roleLabel(selectedUser.role)} 계정`} description={isPending ? "가입 신청 내용을 확인하고 권한과 지점을 지정하세요." : "계정의 권한과 소속 지점을 관리합니다."}>
      <PolicyInfoRows data-component={`${DETAIL_BASE}_account-${selectedUser.id}_info`} title="계정 정보" rows={[{ id: "name", label: "이름", value: selectedUser.name ?? "-" }, { id: "email", label: "이메일", value: selectedUser.email ?? "-" }, { id: "phone", label: "전화번호", value: selectedUser.phone ?? "-" }, { id: "role", label: isPending ? "요청 권한" : "역할", value: roleLabel(isPending ? selectedUser.requestedRole : selectedUser.role) }, { id: "auth", label: "인증 방식", value: selectedUser.authProvider || "-" }, { id: "joined", label: "가입일", value: dateLabel(selectedUser.createdAt) }]} />
      {isPending ? <section data-component={`${DETAIL_BASE}_account-${selectedUser.id}_approval`} className="flex flex-col gap-3"><div className="flex flex-col gap-1.5"><Label htmlFor={`mobile-system-admin-${selectedUser.id}-approval-role`} className="text-[calc(0.7rem*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted">승인 권한</Label><Select value={selectedRole} onValueChange={(value) => setPendingRoles((current) => ({ ...current, [selectedUser.id]: value as EditableRole }))}><SelectTrigger id={`mobile-system-admin-${selectedUser.id}-approval-role`} data-component={`${DETAIL_BASE}_account-${selectedUser.id}_approval_role`} className="h-[44px] w-full rounded-[12px] border-[1.5px] border-input bg-white text-[0.9rem]"><SelectValue /></SelectTrigger><SelectContent>{REGISTERABLE_ROLE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div><div className="flex flex-col gap-1.5"><Label htmlFor={`mobile-system-admin-${selectedUser.id}-approval-branch`} className="text-[calc(0.7rem*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted">소속 지점</Label><Select value={selectedBranchId} onValueChange={(value) => setPendingBranches((current) => ({ ...current, [selectedUser.id]: value }))}><SelectTrigger id={`mobile-system-admin-${selectedUser.id}-approval-branch`} data-component={`${DETAIL_BASE}_account-${selectedUser.id}_approval_branch`} className="h-[44px] w-full rounded-[12px] border-[1.5px] border-input bg-white text-[0.9rem]"><SelectValue placeholder="지점 선택" /></SelectTrigger><SelectContent>{activeBranches.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>)}</SelectContent></Select></div>{selectedRole === "admin" ? <div className="flex flex-col gap-1.5"><Label htmlFor={`mobile-system-admin-${selectedUser.id}-approval-owner-branch`} className="text-[calc(0.7rem*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted">오너 지점 지정</Label><Select value={selectedOwnerBranchId} onValueChange={(value) => setPendingOwnerBranches((current) => ({ ...current, [selectedUser.id]: value }))}><SelectTrigger id={`mobile-system-admin-${selectedUser.id}-approval-owner-branch`} data-component={`${DETAIL_BASE}_account-${selectedUser.id}_approval_owner-branch`} className="h-[44px] w-full rounded-[12px] border-[1.5px] border-input bg-white text-[0.9rem]"><SelectValue placeholder="오너 지점 선택" /></SelectTrigger><SelectContent>{branchOwnerFreeOptions.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>)}</SelectContent></Select></div> : null}<div className="grid grid-cols-2 gap-2"><Button type="button" variant="v3" size="md" width="lg" disabled={approveUserMutation.isPending || !selectedBranchId || (selectedRole === "admin" && !selectedOwnerBranchId)} onClick={() => approveUserMutation.mutate({ id: selectedUser.id, role: selectedRole, branchId: selectedBranchId, ...(selectedRole === "admin" ? { ownerBranchId: selectedOwnerBranchId } : {}) })} data-component={`${DETAIL_BASE}_account-${selectedUser.id}_approve`}>{approveUserMutation.isPending ? "처리 중…" : "가입 승인"}</Button><Button type="button" variant="outline" size="md" width="lg" disabled={rejectUserMutation.isPending} onClick={() => rejectUserMutation.mutate(selectedUser.id)} data-component={`${DETAIL_BASE}_account-${selectedUser.id}_reject`}>반려</Button></div></section> : approvedNonOwner ? <AccountAssignmentForm branches={branches} role={currentRole} selectedBranchIds={currentBranchIds} isSaving={updateAccountMutation.isPending} onRoleChange={(role) => setAccountEditRoles((current) => ({ ...current, [selectedUser.id]: role }))} onBranchToggle={(branchId, checked) => setAccountEditBranches((current) => ({ ...current, [selectedUser.id]: checked ? [...(current[selectedUser.id] ?? currentBranchIds), branchId] : (current[selectedUser.id] ?? currentBranchIds).filter((id) => id !== branchId) }))} onSave={() => updateAccountMutation.mutate({ id: selectedUser.id, input: { role: currentRole, branchIds: currentBranchIds, expectedRole: selectedUser.role as EditableRole, expectedBranchIds: selectedUser.branches.map((branch) => branch.id) } })} /> : <div data-component={`${DETAIL_BASE}_account-${selectedUser.id}_owner-note`} className="rounded-[calc(18px*var(--glint-ui-scale,1))] bg-v3-dim-white p-4 text-[calc(0.72rem*var(--glint-ui-scale,1))] leading-relaxed text-v3-text-muted">오너 계정의 권한은 이 화면에서 변경할 수 없습니다.</div>}
    </DetailContent>;
  }

  return (
    <section data-component={PAGE_BASE} data-slot="messages-page" data-page="system-admin" className="messages-page flex min-h-0 w-full flex-1">
      <div data-component={`${PAGE_BASE}_screen`} className="relative flex min-h-0 w-full flex-1 overflow-hidden">
        <div data-component={`${PAGE_BASE}_screen_content`} data-slot="messages-content" className="shell-content relative min-h-0 flex-1 flex-col gap-[calc(8px*var(--glint-ui-scale,1))] !overflow-hidden">
          <MobileSectionNav data-component={`${PAGE_BASE}_section-nav`} ariaLabel="관리자 기능" items={SECTION_NAV} activeId={activeSection} onSelect={openSection} />
          <SlidingCard data-component={SLIDING_BASE} open={isOpen} onBack={closeDetail} backLabel={activeSection === "branches" ? "지점 관리" : "계정 관리"} detailKey={itemParam} list={list} detail={detail} detailHeaderTrailing={detailStatus ? <StatusPill data-component={`${SLIDING_BASE}_stage_detail-pane_header_status`} variant={detailStatus.variant} className="!rounded-[calc(999px*var(--glint-ui-scale,1))] !px-[calc(8px*var(--glint-ui-scale,1))] !py-[calc(4px*var(--glint-ui-scale,1))] !text-[calc(0.62rem*var(--glint-ui-scale,1))]">{detailStatus.label}</StatusPill> : null} />
        </div>
      </div>
    </section>
  );
}
