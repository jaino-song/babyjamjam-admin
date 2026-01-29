"use client";
import { usePathname } from "next/navigation";
import { Header } from "./Header";
import { useInitialUser } from "@/app/(components)/providers/UserProvider";

// ConditionalHeader는 UserProvider 내부에서 렌더링될 때
// 서버에서 prefetch된 user 데이터를 자동으로 Header에 전달
export const ConditionalHeader = () => {
  const pathname = usePathname();
  const hiddenPaths = ["/", "/login", "/auth/callback", "/chat"];
  const shouldHide = hiddenPaths.includes(pathname);

  // UserProvider가 있으면 prefetch된 user 데이터 사용
  // 없으면 null (Header에서 client-side fetch)
  const initialUser = useInitialUser();

  if (shouldHide) {
    return null;
  }

  return <Header initialUser={initialUser} />;
};
