"use client";

import "./redesign.css";

import { useEffect } from "react";
import { LogOut, PenLine } from "lucide-react";
import { useRouter } from "next/navigation";

import { menuGroups as defaultMenuGroups } from "./mockup-data";
import type { MenuGroup } from "./mockup-data";
import { MenuGroups } from "./primitives";
import { useInitialUser } from "@/providers/UserProvider";

const DEFAULT_PROFILE_NAME = "사용자";
const DEFAULT_PROFILE_ROLE = "스태프";
const DEFAULT_PROFILE_BRANCH = "지점 미선택";
const APP_VERSION = "아가잼잼 어드민 v2.4.1";

function getRoleLabel(role: string | undefined) {
  switch (role) {
    case "owner":
    case "admin":
      return "지점장";
    case "manager":
      return "매니저";
    case "member":
      return "스태프";
    default:
      return DEFAULT_PROFILE_ROLE;
  }
}

function getAvatarInitial(name: string) {
  return name.trim().charAt(0) || DEFAULT_PROFILE_NAME.charAt(0);
}

export interface AllSettingsRedesignProps {
  menuGroups?: MenuGroup[];
}

export function AllSettingsRedesign({ menuGroups = defaultMenuGroups }: AllSettingsRedesignProps) {
  const router = useRouter();
  const user = useInitialUser();
  const profileName = user?.name ?? DEFAULT_PROFILE_NAME;
  const profileRole = getRoleLabel(user?.role);
  const profileBranch = user?.branchName ?? DEFAULT_PROFILE_BRANCH;

  useEffect(() => {
    document.body.classList.add("mobile-all-route");

    return () => {
      document.body.classList.remove("mobile-all-route");
    };
  }, []);

  return (
    <div data-component="all-menu" className="menu-content">
      <div className="profile-card pop-up" data-component="mobile-all-profile-card">
        <div className="profile-avatar">{getAvatarInitial(profileName)}</div>
        <div className="profile-info">
          <div className="profile-name">{profileName}</div>
          <div className="profile-role">
            <span>{profileRole}</span>
            <span className="role-dot" />
            <span>{profileBranch}</span>
          </div>
        </div>
        <button
          type="button"
          className="profile-edit"
          aria-label="프로필 편집"
          onClick={() => router.push("/select-branch")}
        >
          <PenLine size={14} strokeWidth={2.5} />
        </button>
      </div>

      <MenuGroups groups={menuGroups} />

      <button
        type="button"
        className="logout-btn"
        data-component="mobile-all-logout"
        onClick={() => router.push("/logout")}
      >
        <LogOut size={16} strokeWidth={2.5} />
        로그아웃
      </button>
      <div className="app-version">{APP_VERSION}</div>
    </div>
  );
}
