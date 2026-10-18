"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

const getSnapshot = () => navigator.onLine;
const getServerSnapshot = () => true;

export function OfflineNotice({
  "data-component": dataComponent,
}: {
  "data-component": string;
}) {
  const isOnline = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (isOnline) return null;

  return (
    <div
      data-component={dataComponent}
      data-source-component="OfflineNotice"
      role="status"
      className="fixed inset-x-0 top-0 z-50 bg-v3-primary px-4 py-2 text-center text-sm text-white"
    >
      오프라인 상태입니다. 연결되면 자동으로 다시 불러옵니다.
    </div>
  );
}
