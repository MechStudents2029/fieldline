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
  };
}
