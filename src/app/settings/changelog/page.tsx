import { redirect } from "next/navigation";
import { format, parseISO } from "date-fns";
import { ja } from "date-fns/locale";

import { SettingsShell } from "@/components/settings/settings-shell";
import { Card, CardContent } from "@/components/ui/card";
import { APP_VERSION } from "@/lib/app-version";
import { getCurrentUser } from "@/lib/auth-user";
import { APP_CHANGELOG } from "@/lib/changelog";

export default async function ChangelogPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <SettingsShell
      title="更新履歴"
      description={`現在のバージョンは v${APP_VERSION} です。`}
      backHref="/settings"
      backLabel="設定"
    >
      <Card>
        <CardContent className="flex flex-col gap-6">
          {APP_CHANGELOG.map((entry, index) => (
            <section
              key={entry.version}
              className={
                index < APP_CHANGELOG.length - 1 ? "border-b border-outline-variant pb-6" : ""
              }
            >
              <div className="mb-2 flex items-baseline justify-between gap-4">
                <h2 className="font-mono text-sm font-semibold">v{entry.version}</h2>
                <time dateTime={entry.date} className="shrink-0 text-xs text-muted-foreground">
                  {format(parseISO(entry.date), "yyyy年M月d日", { locale: ja })}
                </time>
              </div>

              <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
                {entry.changes.map((change) => (
                  <li key={change} className="flex gap-2">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/60" />
                    <span>{change}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </CardContent>
      </Card>
    </SettingsShell>
  );
}
