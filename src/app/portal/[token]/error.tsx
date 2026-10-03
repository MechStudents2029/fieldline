"use client";

import { FlowError } from "@/components/flow-fallback";

export default function PortalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <FlowError reset={reset} title="This project did not load." />;
}