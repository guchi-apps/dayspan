import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { loadCalendarSettings } from "@/services/google-calendar/settings";

export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await loadCalendarSettings(userId));
}

type PatchBody = {
  settingId?: string;
  visible?: boolean;
  writeEnabled?: boolean;
  isCreateDefault?: boolean;
};

export async function PATCH(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as PatchBody;
  if (!body.settingId) {
    return NextResponse.json({ error: "settingId is required" }, { status: 400 });
  }

  // 他ユーザーの設定を書き換えられないよう、userIdとの組で対象を特定する。
  const setting = await db.calendarSetting.findFirst({
    where: { id: body.settingId, userId },
  });
  if (!setting) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // 使用オフのカレンダーは書き込み先にできない。既定の保存先にも選べない。
  const writeEnabled = body.writeEnabled ?? setting.writeEnabled;
  if (body.isCreateDefault && !writeEnabled) {
    return NextResponse.json(
      {
        error: "calendar_not_writable",
        message: "使用していないカレンダーは、既定の保存先にできません。",
      },
      { status: 400 },
    );
  }

  // 予定の既定の保存先は1つだけ。新しく既定にしたものがあれば、他を落とす。
  if (body.isCreateDefault) {
    await db.calendarSetting.updateMany({
      where: { userId, isCreateDefault: true },
      data: { isCreateDefault: false },
    });
  }

  // 既定の保存先を使用オフにしたら、既定からも外す。残しておくと、入力画面の初期値が
  // 選べないカレンダーのままになる。
  const clearsDefault = body.writeEnabled === false && setting.isCreateDefault;

  const updated = await db.calendarSetting.update({
    where: { id: setting.id },
    data: {
      ...(body.visible === undefined ? {} : { visible: body.visible }),
      ...(body.writeEnabled === undefined ? {} : { writeEnabled: body.writeEnabled }),
      ...(clearsDefault
        ? { isCreateDefault: false }
        : body.isCreateDefault === undefined
          ? {}
          : { isCreateDefault: body.isCreateDefault }),
    },
  });

  return NextResponse.json({
    settingId: updated.id,
    visible: updated.visible,
    writeEnabled: updated.writeEnabled,
    isCreateDefault: updated.isCreateDefault,
  });
}
