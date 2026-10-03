"use client";

import { FlowError } from "@/components/flow-fallback";

export default function PayError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <FlowError reset={reset} title="This invoice did not load." />;
}
