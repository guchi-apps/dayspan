import { db } from "@/lib/db";

import type { IntentStore } from "./google-intent";
import type { HandoffStore } from "./handoff";

/** 期限を過ぎた行の掃除。発行のたびに一緒に行い、専用のタイマーを持たない。 */
const CLEANUP_GRACE_MS = 60 * 60_000;

async function cleanup(now: Date) {
  const before = new Date(now.getTime() - CLEANUP_GRACE_MS);
  await Promise.all([
    db.nativeAuthHandoff.deleteMany({ where: { expiresAt: { lt: before } } }),
    db.googleConnectIntent.deleteMany({ where: { createdAt: { lt: before } } }),
  ]);
}

export const handoffStore: HandoffStore = {
  async create(record) {
    await cleanup(new Date());
    await db.nativeAuthHandoff.create({ data: record });
  },

  async claim(codeHash, purpose, now) {
    // 使用済みにする更新を「確保」として使う。同時に2回来ても count が1になるのは片方だけ。
    const { count } = await db.nativeAuthHandoff.updateMany({
      where: { codeHash, purpose, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (count !== 1) return null;

    const row = await db.nativeAuthHandoff.findUnique({ where: { codeHash } });
    if (!row) return null;
    // 暗号化済みでも、使い終えたトークンをDBへ残さない
    await db.nativeAuthHandoff.delete({ where: { codeHash } });

    return { challengeHash: row.challengeHash, sessionCipher: row.sessionCipher, next: row.next };
  },
};

export const intentStore: IntentStore = {
  async create({ userId, tokenHash, expiresAt }) {
    await cleanup(new Date());
    await db.googleConnectIntent.create({ data: { userId, tokenHash, expiresAt } });
  },

  async start({ tokenHash, stateHash, stateExpiresAt, now }) {
    const { count } = await db.googleConnectIntent.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now, stateHash, stateExpiresAt },
    });
    if (count !== 1) return null;

    const row = await db.googleConnectIntent.findUnique({ where: { tokenHash } });
    return row ? { userId: row.userId } : null;
  },

  async findByState(stateHash) {
    const row = await db.googleConnectIntent.findUnique({ where: { stateHash } });
    return row
      ? { userId: row.userId, stateExpiresAt: row.stateExpiresAt, completedAt: row.completedAt }
      : null;
  },

  async complete(stateHash, now) {
    const { count } = await db.googleConnectIntent.updateMany({
      where: { stateHash, completedAt: null, stateExpiresAt: { gt: now } },
      data: { completedAt: now },
    });
    return count === 1;
  },
};
