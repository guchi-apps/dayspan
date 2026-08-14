import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import type { ActivityPresetItem } from "@/types/activity";

/**
 * 記録の選択肢が1つも無いときに用意する初期値（issue #194）。
 *
 * 空の一覧から始めると、押せば記録できるという機能の形が画面に出ない。
 * よくある区切りをあらかじめ入れておき、要らないものは設定から消してもらう。
 */
export const DEFAULT_ACTIVITY_NAMES = ["睡眠", "移動", "仕事", "プログラミング", "遊び"];

/**
 * 表示順。sortOrder が同じ行でも並びが入れ替わらないよう、作成順を第二の基準にする
 * （google-calendar/settings.ts の SETTING_ORDER と同じ考え方）。
 */
const PRESET_ORDER: Prisma.ActivityPresetOrderByWithRelationInput[] = [
  { sortOrder: "asc" },
  { createdAt: "asc" },
];

/** 選択肢の名前の上限。VARCHAR(191) に収め、カレンダーの枠でも読める長さに留める。 */
export const ACTIVITY_NAME_MAX_LENGTH = 40;

/**
 * 記録の選択肢を返す。まだ初期値を入れたことがないユーザーには、入れてから返す。
 *
 * 初期値を入れるのは読み取りの側だが、無ければ作るという扱いにしておかないと、
 * 「設定画面を先に開いた人だけ使える」状態になる。並行に呼ばれても二重に増えないよう、
 * 一意制約（userId + name）に任せて skipDuplicates で足す。
 *
 * 「1件も無いなら入れる」だけでは判断しない。利用者が全部消しても開き直すたびに
 * 戻ってきて、消せない項目になってしまうため。
 */
export async function listActivityPresets(userId: string): Promise<ActivityPresetItem[]> {
  const existing = await db.activityPreset.findMany({ where: { userId }, orderBy: PRESET_ORDER });
  if (existing.length > 0) return existing.map(toItem);

  const setting = await db.uiSetting.findUnique({
    where: { userId },
    select: { activityPresetsSeeded: true },
  });
  if (setting?.activityPresetsSeeded) return [];

  // 印を先に立てる。作成の途中で失敗しても、次に開いたときに残りが足されるだけで済む
  // （逆順にすると、印が立たないまま消した項目が何度でも戻ってくる）。
  await db.uiSetting.upsert({
    where: { userId },
    create: { userId, activityPresetsSeeded: true },
    update: { activityPresetsSeeded: true },
  });

  await db.activityPreset.createMany({
    data: DEFAULT_ACTIVITY_NAMES.map((name, index) => ({ userId, name, sortOrder: index })),
    skipDuplicates: true,
  });

  const seeded = await db.activityPreset.findMany({ where: { userId }, orderBy: PRESET_ORDER });
  return seeded.map(toItem);
}

/**
 * 選択肢を1つ足す。並びの末尾へ置く。
 * 途中へ割り込ませると、押す位置を覚えている利用者にとって並びが変わって見えるため。
 */
export async function createActivityPreset(
  userId: string,
  input: { name: string; calendarId: string | null },
): Promise<ActivityPresetItem> {
  const last = await db.activityPreset.findFirst({
    where: { userId },
    orderBy: { sortOrder: "desc" },
  });

  const created = await db.activityPreset.create({
    data: {
      userId,
      name: input.name,
      calendarId: input.calendarId,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });

  return toItem(created);
}

/** 選択肢の名前・保存先を変える。他ユーザーの行を触れないよう userId で必ず絞る。 */
export async function updateActivityPreset(
  userId: string,
  presetId: string,
  input: { name?: string; calendarId?: string | null },
): Promise<ActivityPresetItem | null> {
  const result = await db.activityPreset.updateMany({
    where: { id: presetId, userId },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.calendarId === undefined ? {} : { calendarId: input.calendarId }),
    },
  });
  if (result.count === 0) return null;

  const updated = await db.activityPreset.findUnique({ where: { id: presetId } });
  return updated ? toItem(updated) : null;
}

export async function deleteActivityPreset(userId: string, presetId: string): Promise<boolean> {
  const result = await db.activityPreset.deleteMany({ where: { id: presetId, userId } });
  return result.count > 0;
}

/**
 * 並び順をまとめて保存する。渡されたIDの並びをそのまま sortOrder にする。
 *
 * 1つずつ入れ替えると、途中で失敗したときに同じ順位の行が残る。
 * 画面が持っている並び全体を受け取り、1つのトランザクションで置き換える。
 */
export async function reorderActivityPresets(userId: string, ids: string[]): Promise<boolean> {
  const owned = await db.activityPreset.findMany({ where: { userId }, select: { id: true } });
  const ownedIds = new Set(owned.map((preset) => preset.id));

  // 一部だけを並べ替えると、渡されなかった行の順位が宙に浮く。全件そろっているときだけ受ける。
  if (ids.length !== ownedIds.size || ids.some((id) => !ownedIds.has(id))) return false;

  await db.$transaction(
    ids.map((id, index) =>
      db.activityPreset.update({ where: { id }, data: { sortOrder: index } }),
    ),
  );

  return true;
}

function toItem(preset: { id: string; name: string; calendarId: string | null }): ActivityPresetItem {
  return { id: preset.id, name: preset.name, calendarId: preset.calendarId };
}
