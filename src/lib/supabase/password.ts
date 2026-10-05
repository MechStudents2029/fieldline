import type { PasswordAuth } from "@/lib/auth/login";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function supabasePasswordAuth(): Promise<PasswordAuth> {
  const supabase = await createSupabaseServerClient();
  return {
    async signInWithPassword({ email, password }) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.user) return { ok: false, error: error?.message || "Sign-in failed." };
      return { ok: true, userId: data.user.id, email: data.user.email || email };
    },
    async signOut() {
      await supabase.auth.signOut();
    },
    async signUp({ email, password, name }) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name } },
      });
      if (error || !data.user) return { ok: false as const, error: error?.message || "Sign-up failed." };
      if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        return { ok: false as const, error: "That email is already registered. Sign in instead." };
      }
      return {
        ok: true as const,
        userId: data.user.id,
        email: data.user.email || email,
        confirmed: Boolean(data.session),
      };
    },
  };
}
