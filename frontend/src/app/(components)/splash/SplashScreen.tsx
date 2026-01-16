"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { useServiceWorkerUpdate } from "@/app/hooks/useServiceWorkerUpdate";

const MIN_SPLASH_TIME = 1500;

function isPWAStandalone(): boolean {
  if (typeof window === "undefined") return false;

  const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
  const isIOSStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;

  return isStandalone || isIOSStandalone;
}

export default function SplashScreen() {
  const [isPWA, setIsPWA] = useState(false);
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);
  const { isUpdating } = useServiceWorkerUpdate();

  useEffect(() => {
    setIsPWA(isPWAStandalone());
  }, []);

  useEffect(() => {
    if (!isPWA) return;
    const timer = setTimeout(() => setMinTimeElapsed(true), MIN_SPLASH_TIME);
    return () => clearTimeout(timer);
  }, [isPWA]);

  const shouldShow = isPWA && (!minTimeElapsed || isUpdating);

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#0047AB",
          }}
        >
          <Image
            src="/assets/images/Splash Screen.png"
            alt="Splash"
            fill
            style={{ objectFit: "cover" }}
            priority
          />
          {isUpdating && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={{
                position: "absolute",
                bottom: "15%",
                color: "#ffffff",
                fontSize: "16px",
                fontWeight: 500,
                zIndex: 10000,
              }}
            >
              앱 업데이트 중...
            </motion.p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
