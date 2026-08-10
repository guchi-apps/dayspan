import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { createNotionClient } from "@/services/notion/client";
import { validatePlaceDataSource } from "@/services/notion/place-database";

export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const connection = await db.notionConnection.findUnique({ where: { userId } });
  if (!connection) return NextResponse.json({ error: "not_connected" }, { status: 404 });
  const { dataSourceId } = (await request.json()) as { dataSourceId?: string };
  if (!dataSourceId) return NextResponse.json({ error: "dataSourceId is required" }, { status: 400 });

  let validation;
  try {
    validation = await validatePlaceDataSource(createNotionClient(connection), dataSourceId);
  } catch (error) {
    return externalApiError("notion", "場所DBの検証", error);
  }
  if (validation.missingRequired.length) {
    return NextResponse.json({ error: "missing_properties", ...validation }, { status: 422 });
  }
  await db.notionConnection.update({
    where: { userId },
    data: {
      placeDataSourceId: dataSourceId,
      placeDatabaseId: validation.databaseId,
      placeTitle: validation.title,
      placePropertyMap: validation.propertyMap,
      lastValidatedAt: new Date(),
    },
  });
  return NextResponse.json(validation);
}
