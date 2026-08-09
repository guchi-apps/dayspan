"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function GoogleLoginButton() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    const supabase = createClient();

    const callbackUrl = searchParams.get("callbackUrl");
    const next = callbackUrl && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")
      ? callbackUrl
      : "/calendar";

    // Google Calendarの権限はここでは要求しない。ログイン用のGoogle OAuthクライアントは
    // 他アプリと共有のSupabaseプロジェクト側にあるため、カレンダー権限はDaySpan専用の
    // OAuthクライアントで別途取得する（docs/spec.md §17、src/services/google-calendar/）。
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    if (error) {
      setLoading(false);
    }
  };

  return (
    <Button className="w-full" onClick={handleLogin} disabled={loading}>
      {loading ? "リダイレクト中..." : "Googleでログイン"}
    </Button>
  );
}
