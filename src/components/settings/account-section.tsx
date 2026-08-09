import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function AccountSection({ email, name }: { email: string | null; name: string | null }) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          {name && <span className="type-body-large truncate font-medium">{name}</span>}
          <span className="type-body-medium truncate text-on-surface-variant">
            {email ?? "ログイン中"}
          </span>
        </div>

        {/* JSの読み込みを待たずに押せるよう、fetchではなく素のフォーム送信にする。 */}
        <form action="/auth/signout" method="post">
          <Button type="submit" variant="outline" size="sm">
            <LogOut className="size-4" />
            ログアウト
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
