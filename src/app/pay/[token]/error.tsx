"use client";

import { FlowError } from "@/components/flow-fallback";

export default function PayError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <FlowError error={error} retry={retry} title="This invoice did not load." />;
}
