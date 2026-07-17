import { useCallback, useState } from "react";

export function useNavigationPending(isActionPending: boolean) {
  const [isNavigating, setIsNavigating] = useState(false);

  const beginNavigation = useCallback(() => {
    setIsNavigating(true);
  }, []);

  return {
    isPending: isActionPending || isNavigating,
    beginNavigation,
  };
}
