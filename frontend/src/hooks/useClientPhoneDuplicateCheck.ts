import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api/client";

const PHONE_DUPLICATE_CHECK_MAX_RETRIES = 3;
const PHONE_DUPLICATE_CHECK_RETRY_DELAY_MS = 1000;

interface UseClientPhoneDuplicateCheckParams {
  phone: string | null | undefined;
  originalPhone?: string | null;
  enabled?: boolean;
}

export function useClientPhoneDuplicateCheck({
  phone,
  originalPhone,
  enabled = true,
}: UseClientPhoneDuplicateCheckParams) {
  const [isCheckingPhoneDuplicate, setIsCheckingPhoneDuplicate] = useState(false);
  const [isPhoneDuplicate, setIsPhoneDuplicate] = useState(false);
  const [hasPhoneDuplicateCheckFailed, setHasPhoneDuplicateCheckFailed] = useState(false);
  const [lastCheckedPhoneDigits, setLastCheckedPhoneDigits] = useState<string | null>(null);

  const phoneDigits = useMemo(() => phone?.replace(/\D/g, "") ?? "", [phone]);
  const originalPhoneDigits = useMemo(
    () => originalPhone?.replace(/\D/g, "") ?? null,
    [originalPhone],
  );
  const isUsingOriginalPhone = Boolean(
    originalPhoneDigits && phoneDigits === originalPhoneDigits,
  );

  useEffect(() => {
    if (!enabled || phoneDigits.length !== 11 || isUsingOriginalPhone) {
      return;
    }

    const abortController = new AbortController();

    const waitForRetryDelay = () =>
      new Promise<void>((resolve) => {
        const finish = () => {
          abortController.signal.removeEventListener("abort", handleAbort);
          resolve();
        };
        const timeoutId = setTimeout(finish, PHONE_DUPLICATE_CHECK_RETRY_DELAY_MS);
        const handleAbort = () => {
          clearTimeout(timeoutId);
          finish();
        };

        if (abortController.signal.aborted) {
          handleAbort();
          return;
        }

        abortController.signal.addEventListener("abort", handleAbort, { once: true });
      });

    const checkPhoneDuplicate = async () => {
      setIsCheckingPhoneDuplicate(true);
      setIsPhoneDuplicate(false);
      setHasPhoneDuplicateCheckFailed(false);
      setLastCheckedPhoneDigits(null);

      let attempt = 0;

      while (!abortController.signal.aborted && attempt <= PHONE_DUPLICATE_CHECK_MAX_RETRIES) {
        try {
          const response = await api.get("/clients/check-phone", {
            params: { phone: phoneDigits },
            signal: abortController.signal,
          });

          if (!abortController.signal.aborted) {
            setIsPhoneDuplicate(response.data?.exists === true);
            setHasPhoneDuplicateCheckFailed(false);
            setLastCheckedPhoneDigits(phoneDigits);
          }
          return;
        } catch {
          if (abortController.signal.aborted) {
            return;
          }

          attempt += 1;
          if (attempt > PHONE_DUPLICATE_CHECK_MAX_RETRIES) {
            setIsPhoneDuplicate(false);
            setHasPhoneDuplicateCheckFailed(true);
            return;
          }

          await waitForRetryDelay();
        }
      }
    };

    void checkPhoneDuplicate().finally(() => {
      if (!abortController.signal.aborted) {
        setIsCheckingPhoneDuplicate(false);
      }
    });

    return () => {
      abortController.abort();
      setIsCheckingPhoneDuplicate(false);
    };
  }, [enabled, isUsingOriginalPhone, phoneDigits]);

  const isPhoneCheckReady =
    phoneDigits.length === 11 &&
    (isUsingOriginalPhone ||
      (!isCheckingPhoneDuplicate &&
        !hasPhoneDuplicateCheckFailed &&
        !isPhoneDuplicate &&
        lastCheckedPhoneDigits === phoneDigits));

  return {
    phoneDigits,
    isCheckingPhoneDuplicate,
    isPhoneDuplicate,
    hasPhoneDuplicateCheckFailed,
    lastCheckedPhoneDigits,
    isUsingOriginalPhone,
    isPhoneCheckReady,
  };
}
