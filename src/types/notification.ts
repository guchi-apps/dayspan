/**
 * 通知の設定（docs/spec.md §32）のうち、画面とサーバーの両方で使う型と選択肢。
 *
 * サービス層（services/notifications/settings.ts）に置くと、設定画面（クライアント
 * コンポーネント）がそこを読んだ時点でPrismaまでブラウザのバンドルへ引き込まれる。
 * 型と定数だけをここへ分ける。
 */

export type NotificationSettings = {
  eventEnabled: boolean;
  eventLeadMinutes: number;
  taskEnabled: boolean;
  /** 時刻の無い期限をまとめて知らせる時刻（設定タイムゾーンでの HH:MM）。 */
  taskDigestTime: string;
  activityEnabled: boolean;
};

/**
 * 予定の何分前に知らせるか。自由入力にしないのは、1分刻みで選べても選ぶ値がこの中に
 * 落ち着くため。0は開始時刻ちょうど。
 */
export const EVENT_LEAD_MINUTES = [0, 5, 10, 15, 30, 60] as const;

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  eventEnabled: true,
  eventLeadMinutes: 10,
  taskEnabled: true,
  taskDigestTime: "08:00",
  activityEnabled: true,
};
