"use client";

import { createContext, useContext, ReactNode } from "react";
import { AuthUser } from "@/app/hooks/useGetAuthUser";

interface UserContextValue {
  user: AuthUser | null;
}

const UserContext = createContext<UserContextValue | undefined>(undefined);

interface UserProviderProps {
  children: ReactNode;
  user: AuthUser | null;
}

// 서버 컴포넌트에서 prefetch된 user 데이터를 클라이언트 컴포넌트에 전달
export const UserProvider = ({ children, user }: UserProviderProps) => {
  return (
    <UserContext.Provider value={{ user }}>
      {children}
    </UserContext.Provider>
  );
};

// Context 값을 읽는 훅
export const useInitialUser = (): AuthUser | null => {
  const context = useContext(UserContext);
  // Context가 없으면 null 반환 (protected route 외부에서 사용 시)
  return context?.user ?? null;
};
