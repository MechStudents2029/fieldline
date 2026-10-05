"use client";

import { useRef } from "react";
import { logoutAction } from "@/app/actions";
import { clearScope, countUnsynced, type Scope } from "@/lib/offline/browser";

export function SignOutButton({ scope, className, label = "Sign out" }: { scope: Scope; className?: string; label?: string }) {
  const armed = useRef(false);
  return (
    <form
      action={logoutAction}
      onSubmit={(event) => {
        if (armed.current) {
          armed.current = false;
          return;
        }
        event.preventDefault();
        const form = event.currentTarget;
        void countUnsynced(scope).then(async (count) => {
          if (count > 0) {
            const ok = window.confirm(
              `${count} saved on this phone and not synced yet. Signing out removes them from this phone.`,
            );
            if (!ok) return;
          }
          await clearScope(scope);
          armed.current = true;
          form.requestSubmit();
        });
      }}
    >
      <button className={className}>{label}</button>
    </form>
  );
}
