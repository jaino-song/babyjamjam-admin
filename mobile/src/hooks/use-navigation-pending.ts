"use client";

import { useCallback, useState } from "react";

interface NavigationPendingState {
  isNavigationPending: boolean;
  startNavigation: () => void;
}

export function useNavigationPending(): NavigationPendingState {
  const [isNavigationPending, setIsNavigationPending] = useState(false);
  const startNavigation = useCallback(() => setIsNavigationPending(true), []);

  return { isNavigationPending, startNavigation };
}
