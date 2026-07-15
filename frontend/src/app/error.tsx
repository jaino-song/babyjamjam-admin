"use client";

import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";

interface ErrorPageProps {
  error: Error & { digest?: string };
}

export default function ErrorPage({ error }: ErrorPageProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return <NextError statusCode={0} />;
}
