"use client";

import { FlowError } from "@/components/flow-fallback";

export default function ProposalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <FlowError reset={reset} title="This proposal did not load." />;
}
