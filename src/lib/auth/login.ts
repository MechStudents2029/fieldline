import { actorFromAuthUser } from "@/lib/auth/membership";
import { supabaseAuthConfigured, type Env } from "@/lib/supabase/env";
import { authenticate, type Actor } from "@/lib/services/read";

export type SignUpResult =
  | { ok: true; userId: string; email: string; confirmed: boolean }
  | { ok: false; error: string };

export type PasswordAuth = {
  signInWithPassword(input: { email: string; password: string }): Promise<
    { ok: true; userId: string; email: string } | { ok: false; error: string }
  >;
  signOut(): Promise<void>;
  signUp?(input: { email: string; password: string; name: string }): Promise<SignUpResult>;
};

export type LoginResult = { ok: true; actor: Actor } | { ok: false; error: string };

const DEMO_ERROR = "That email and password do not match a demo user. Password is demo.";

/**
 * Empty Supabase env keeps the local demo password check.
 * With Supabase configured, the local password is not accepted.
 */
export async function resolveLogin(email: string, password: string, options: { env: Env; auth?: PasswordAuth }): Promise<LoginResult> {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !password) return { ok: false, error: "Enter an email and password." };
  if (!supabaseAuthConfigured(options.env)) {
    const actor = authenticate(normalized, password);
    if (!actor) return { ok: false, error: DEMO_ERROR };
    return { ok: true, actor };
  }
  if (!options.auth) return { ok: false, error: "Supabase Auth is not available." };
  const signed = await options.auth.signInWithPassword({ email: normalized, password });
  if (!signed.ok) return { ok: false, error: "That email and password were not accepted." };
  const actor = actorFromAuthUser(signed.userId, signed.email || normalized);
  if (!actor) {
    await options.auth.signOut();
    return { ok: false, error: "This Supabase user is not a member of a Fieldline company." };
  }
  return { ok: true, actor };
}
