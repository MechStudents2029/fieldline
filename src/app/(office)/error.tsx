"use client";

import { FlowError } from "@/components/flow-fallback";

export default function OfficeError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <FlowError error={error} retry={retry} title="The job file did not load." />;
}
