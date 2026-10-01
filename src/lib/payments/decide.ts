export type RailDecision =
  | { ok: true; method: "ach" | "card" }
  | { ok: false; method: "ach" | "card"; reason: string };

const ACH_RESULTS: Record<string, { ok: true } | { ok: false; reason: string }> = {
  "110000000|000123456789": { ok: true },
  "110000000|000111111113": { ok: false, reason: "Account closed." },
  "110000000|000111111116": { ok: false, reason: "No account found for that number." },
  "110000000|000222222227": { ok: false, reason: "Insufficient funds." },
};

export function decideAch(routing: string, account: string): RailDecision {
  const key = `${routing.replace(/\D/g, "")}|${account.replace(/\D/g, "")}`;
  const known = ACH_RESULTS[key];
  if (!known) {
    return {
      ok: false,
      method: "ach",
      reason:
        "Use a Stripe test bank account in this demo (routing 110000000, account 000123456789). Live ACH runs only when Stripe keys are set.",
    };
  }
  if (known.ok) return { ok: true, method: "ach" };
  return { ok: false, method: "ach", reason: known.reason };
}

export function decideCard(number: string, exp: string, cvc: string): RailDecision {
  const pan = number.replace(/\D/g, "");
  if (!/^\d{2}\/\d{2}$/.test(exp.trim()) || !/^\d{3,4}$/.test(cvc.trim())) {
    return { ok: false, method: "card", reason: "Enter a future expiration as MM/YY and a CVC." };
  }
  const [mm, yy] = exp.split("/");
  const expDate = new Date(2000 + Number(yy), Number(mm) - 1, 1);
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  if (Number.isNaN(expDate.getTime()) || expDate < thisMonth) {
    return { ok: false, method: "card", reason: "That card is expired." };
  }
  if (pan === "4242424242424242") return { ok: true, method: "card" };
  if (pan === "4000000000000002") return { ok: false, method: "card", reason: "The card was declined." };
  if (pan === "4000000000009995") {
    return { ok: false, method: "card", reason: "Insufficient funds." };
  }
  return {
    ok: false,
    method: "card",
    reason: "Use Stripe test card 4242 4242 4242 4242 in this demo. Live cards run only when Stripe keys are set.",
  };
}
