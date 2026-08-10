import { NextResponse } from "next/server";
import type { NotionConnection } from "@prisma/client";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import {
  addTagOption,
  isTagColor,
  removeTagOption,
  tagLocation,
  type TagColor,
  type TagKind,
} from "@/services/notion/tag-options";

// タスクのタグ・日付リマインドの種類の選択肢を追加・削除する。
// 選択肢はNotion側のプロパティ定義が一次情報源のため、DaySpanのDBには保存しない。
// 既存の選択肢の名前と色はNotion APIが変更を受け付けないため、更新の口は用意しない。

type Prepared =
  | { error: NextResponse; kind?: undefined; connection?: undefined; name?: undefined }
  | { error?: undefined; kind: TagKind; connection: NotionConnection; name: string };

function reject(body: Record<string, unknown>, status: number): Prepared {
  return { error: NextResponse.json(body, { status }) };
}

/** 追加も削除もNotionの現状を取り直して書き戻すため、前準備は同じ。 */
async function prepare(rawKind: unknown, rawName: unknown): Promise<Prepared> {
  const userId = await requireUserId();
  if (!userId) return reject({ error: "unauthorized" }, 401);

  if (rawKind !== "task" && rawKind !== "reminder") {
    return reject({ error: "kind is required" }, 400);
  }
  const kind: TagKind = rawKind;

  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (!name) return reject({ error: "name is required" }, 400);

  const connection = await db.notionConnection.findUnique({ where: { userId } });
  if (!connection) return reject({ error: "not_connected" }, 404);

  // タグ用のプロパティが無いDBを選んでいることもある。何を直せばよいか分かる形で返す。
  if (!tagLocation(connection, kind)) {
    return reject(
      {
        error: "tag_property_missing",
        message:
          kind === "task"
            ? "タスクDBにタグ（マルチセレクト）のプロパティがありません。"
            : "日付リマインドDBに種類（セレクト）のプロパティがありません。",
      },
      422,
    );
  }

  return { kind, connection, name };
}

export async function POST(request: Request) {
  const body = (await request.json()) as { kind?: unknown; name?: unknown; color?: unknown };

  const prepared = await prepare(body.kind, body.name);
  if (prepared.error) return prepared.error;

  // 色を選べるのは追加のときだけ。Notionは既存の選択肢の色を変更させない。
  const color: TagColor = isTagColor(body.color) ? body.color : "default";

  try {
    const options = await addTagOption(prepared.connection, prepared.kind, prepared.name, color);
    return NextResponse.json({ options });
  } catch (error) {
    return externalApiError("notion", "add tag option", error);
  }
}

export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;

  const prepared = await prepare(params.get("kind"), params.get("name"));
  if (prepared.error) return prepared.error;

  try {
    const options = await removeTagOption(prepared.connection, prepared.kind, prepared.name);
    return NextResponse.json({ options });
  } catch (error) {
    return externalApiError("notion", "remove tag option", error);
  }
}
