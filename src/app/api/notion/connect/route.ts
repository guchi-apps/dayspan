import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { encryptSecret } from "@/lib/crypto/secret-cipher";
import { db } from "@/lib/db";
import { createNotionClientFromToken } from "@/services/notion/client";

type Body = { token?: string };

/**
 * NotionのInternal Integration Tokenを受け取り、有効性を確認してから暗号化して保存する。
 * トークンは環境変数ではなくユーザーごとにDBへ持つ（将来の一般公開でユーザー単位の連携にするため）。
 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as Body;
  const token = body.token?.trim();

  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  // 保存前に1回叩いて、トークンが有効であることを確かめる。
  // 無効なトークンを保存すると、以降の画面がすべて失敗する状態になってしまう。
  let workspaceName: string | null = null;
  try {
    const notion = createNotionClientFromToken(token);
    const me = await notion.users.me({});
    workspaceName = me.type === "bot" ? (me.bot.workspace_name ?? null) : (me.name ?? null);
  } catch {
    return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  }

  const encrypted = encryptSecret(token);

  const connection = await db.notionConnection.upsert({
    where: { userId },
    create: { userId, accessToken: encrypted, workspaceName },
    // トークンを入れ替えたら、以前のワークスペースのタスクDB選択は無効になる可能性が高いので落とす。
    update: {
      accessToken: encrypted,
      workspaceName,
      taskDataSourceId: null,
      taskDatabaseId: null,
      taskTitle: null,
      propertyMap: undefined,
      lastValidatedAt: null,
    },
  });

  return NextResponse.json({
    connected: true,
    workspaceName: connection.workspaceName,
  });
}

export async function DELETE() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await db.notionConnection.deleteMany({ where: { userId } });

  return NextResponse.json({ ok: true });
}
