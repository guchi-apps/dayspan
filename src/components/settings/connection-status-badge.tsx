import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";

const TONE_VARIANT = {
  connected: "secondary",
  not_connected: "outline",
  attention: "destructive",
} as const;

/**
 * 接続状態の表示をM3のバッジの語彙（tonal / outline / error）に揃える。
 * Google Calendar・Notionの両方の接続状態表示から共通で使う。
 */
export function ConnectionStatusBadge({
  tone,
  children,
}: {
  tone: keyof typeof TONE_VARIANT;
  children: ReactNode;
}) {
  return <Badge variant={TONE_VARIANT[tone]}>{children}</Badge>;
}
