"use client";

import { useState } from "react";
import { payAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";

export function PayForm({ token, cardEnabled }: { token: string; cardEnabled: boolean }) {
  const [key] = useState(() => `pay_${token}_${crypto.randomUUID()}`);
  const [method, setMethod] = useState<"ach" | "card">("ach");
  return (
    <ActionForm action={payAction.bind(null, token, key)} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setMethod("ach")} className={`rounded-lg border px-3 py-3 text-sm ${method === "ach" ? "border-pine bg-primary text-primary-foreground" : "bg-card"}`}>
          Bank account (ACH)
        </button>
        <button type="button" disabled={!cardEnabled} onClick={() => setMethod("card")} className={`rounded-lg border px-3 py-3 text-sm ${method === "card" ? "border-pine bg-primary text-primary-foreground" : "bg-card"}`}>
          Card
        </button>
      </div>
      <input type="hidden" name="method" value={method} />
      {method === "ach" ? (
        <>
          <label className="text-sm">
            Routing number
            <input name="routing" className="field mt-1" defaultValue="110000000" inputMode="numeric" autoComplete="off" />
          </label>
          <label className="text-sm">
            Account number
            <input name="account" className="field mt-1" defaultValue="000123456789" inputMode="numeric" autoComplete="off" />
          </label>
          <p className="text-xs text-muted-foreground">
            Demo success: routing 110000000, account 000123456789. Insufficient funds: 000222222227.
          </p>
        </>
      ) : (
        <>
          <label className="text-sm">
            Card number
            <input name="card" className="field mt-1" defaultValue="4242424242424242" inputMode="numeric" autoComplete="off" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">
              Exp
              <input name="exp" className="field mt-1" defaultValue="12/30" />
            </label>
            <label className="text-sm">
              CVC
              <input name="cvc" className="field mt-1" defaultValue="123" />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">Demo success card 4242 4242 4242 4242. Decline: 4000 0000 0000 0002.</p>
        </>
      )}
      <Button type="submit" className="h-11">
        Pay {method === "ach" ? "by ACH" : "by card"}
      </Button>
    </ActionForm>
  );
}
