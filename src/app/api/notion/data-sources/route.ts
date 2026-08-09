import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { createNotionClient } from "@/services/notion/client";
import { listCandidateDataSources } from "@/services/notion/task-database";

/** Integrationに共有されているデータソースを、タスクDBの選択候補として返す。 */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const connection = await db.notionConnection.findUnique({ where: { userId } });
  if (!connection) {
    return NextResponse.json({ error: "not_connected" }, { status: 404 });
  }

  try {
    const notion = createNotionClient(connection);
    const dataSources = await listCandidateDataSources(notion);
    return NextResponse.json({ dataSources });
  } catch {
    return NextResponse.json({ error: "notion_request_failed" }, { status: 502 });
  }
}
