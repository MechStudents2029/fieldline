"use client";

import { FlowError } from "@/components/flow-fallback";

export default function OfficeError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <FlowError reset={reset} title="The job file did not load." />;
}
