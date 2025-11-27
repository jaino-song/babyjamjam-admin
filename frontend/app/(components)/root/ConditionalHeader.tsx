"use client";
import { usePathname } from "next/navigation";
import { Header } from "./Header";

export const ConditionalHeader = () => {
  const pathname = usePathname();
  const hiddenPaths = ["/", "/login"];
  const shouldHide = hiddenPaths.includes(pathname);

  if (shouldHide) {
    return null;
  }

  return <Header />;
};

