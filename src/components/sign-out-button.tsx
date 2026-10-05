"use client";

import { useEffect, useRef } from "react";
import { logoutAction } from "@/app/actions";
import { clearScope, loadLastScope, outboxSnapshot, type Scope } from "@/lib/offline/browser";

export function SignOutButton({ scope, className, label = "Sign out" }: { scope: Scope; className?: string; label?: string }) {
  const armed = useRef(false);
  useEffect(() => {
    void loadLastScope();
  }, []);
  return (
    <form
      action={logoutAction}
      onSubmit={(event) => {
        if (armed.current) {
          armed.current = false;
          return;
        }
        const waiting = outboxSnapshot().events.filter((row) => row.orgId === scope.orgId && row.userId === scope.userId);
        if (waiting.length === 0) return;
        event.preventDefault();
        const form = event.currentTarget;
        const ok = window.confirm(`${waiting.length} saved on this phone and not synced yet. Signing out removes them from this phone.`);
        if (!ok) return;
        void clearScope(scope).then(() => {
          armed.current = true;
          form.requestSubmit();
        });
      }}
    >
      <button className={className}>{label}</button>
    </form>
  );
}
