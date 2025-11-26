"use client";
import { usePathname } from "next/navigation";
import { Header } from "./Header";

export const ConditionalHeader = () => {
  const pathname = usePathname();
  const isHomePage = pathname === "/";

  if (isHomePage) {
    return null;
  }

  return <Header />;
};

