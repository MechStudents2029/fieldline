import type { PasswordAuth } from "@/lib/auth/login";
import { createCompany, emailTaken } from "@/lib/services/onboarding";
import type { Actor } from "@/lib/services/read";
import { parseSignup, signupAllowed } from "@/lib/security";
import { supabaseAuthConfigured, type Env } from "@/lib/supabase/env";

export type RegisterResult =
  | { status: "signed-in"; actor: Actor }
  | { status: "confirm"; message: string }
  | { status: "error"; error: string };

const CONFIRM_MESSAGE =
  "Confirm this email in the message Supabase sent, then sign in. Fieldline does not send a second email, and the company is ready when you return.";

export async function registerCompany(
  raw: {
    ownerName: string;
    email: string;
    password: string;
    companyName: string;
    trade: string;
    state: string;
    starter: boolean;
  },
  options: { env: Env; ip: string; auth?: PasswordAuth },
): Promise<RegisterResult> {
  const parsed = parseSignup(raw);
  if (!parsed.ok) return { status: "error", error: parsed.error };
  if (!signupAllowed(options.ip)) {
    return { status: "error", error: "Too many new companies from this network. Wait a few minutes and try again." };
  }
  if (emailTaken(parsed.value.email)) {
    return { status: "error", error: "That email already has a Fieldline account. Sign in instead." };
  }
  let authUserId: string | null = null;
  let confirmed = true;
  if (supabaseAuthConfigured(options.env)) {
    if (!options.auth?.signUp) return { status: "error", error: "Supabase Auth is not available." };
    const signed = await options.auth.signUp({
      email: parsed.value.email,
      password: parsed.value.password,
      name: parsed.value.ownerName,
    });
    if (!signed.ok) return { status: "error", error: signed.error };
    authUserId = signed.userId;
    confirmed = signed.confirmed;
  }
  const created = createCompany({ ...parsed.value, authUserId });
  if (!created.ok) return { status: "error", error: created.error };
  if (!confirmed) return { status: "confirm", message: CONFIRM_MESSAGE };
  return { status: "signed-in", actor: created.actor };
}
