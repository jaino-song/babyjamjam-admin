import { redirect } from "next/navigation";

// /settings 접속 시 기본 탭인 voucher-price로 리다이렉트
export default function SettingsPage() {
  redirect("/settings/voucher-price");
}
