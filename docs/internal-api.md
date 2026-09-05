# サーバー間参照用API（`/api/internal/*`）

同一VPS上で動く他アプリ（現状は [guchi-apps/aide](https://github.com/guchi-apps/aide)）が、その日の予定・タスク・日付リマインド・移動を参照するためのAPI（通知の送信を走らせる入口もここに置く）。ブラウザからの利用は想定しておらず、Supabaseのセッションではなく**共有シークレット1本**で守る。

- 経緯: guchi-apps/dayspan#236、guchi-apps/question#7
- 到達経路: DaySpanはVPS上で `127.0.0.1:3113`（`deploy/ecosystem.config.js` の `PORT`）で待ち受ける。呼び出し元も同じVPS上にいるため、**呼び出しにインターネットを経由する必要はない**
- ただし **`https://dayspan.gucchii.com/api/internal/...` として外部からも到達する。** Apacheがドメイン配下を丸ごと `127.0.0.1:3113` へ渡しており、このパスだけを閉じてはいない。守りは共有シークレット1本だけなので、**キーは推測できない長さの乱数にする**（`openssl rand -base64 32`）
- 同じ方式の先行事例: guchi-apps/subscription-lists の `docs/internal-api.md`（環境変数名・認証の作りを揃えてある）

## 認証

```
Authorization: Bearer <INTERNAL_API_KEY>
```

| 状況 | 応答 |
| --- | --- |
| `INTERNAL_API_KEY` が未設定 | `503`（機能として無効。設定漏れが「認証なしの公開」に化けないようにしている） |
| ヘッダなし・キー不一致 | `401` |
| 一致 | `200` |

キーの比較は `node:crypto` の `timingSafeEqual` で定数時間で行う（`src/lib/internal-auth.ts`）。トークンはクエリではなく `Authorization` ヘッダーで受ける。クエリに載せるとApacheのアクセスログにそのまま残る（iPhoneウィジェットのトークンと同じ理由。docs/spec.md §28）。

`/api/internal/` は `src/proxy.ts`（`src/lib/supabase/middleware.ts`）がSupabaseへ問い合わせずに素通しする。認証がキーで完結しており、呼ばれるたびにSupabase Authへ往復させる理由が無いため。matcherからは外さない（外すと詐称されたユーザーIDヘッダーが後段へ届く）。

**対象ユーザーは `ALLOWED_GOOGLE_EMAILS` で引く。** 利用者が1人だけの前提のため、APIキーとユーザーの対応表はDBに持っていない。**この環境変数が2件以上を含むときは `500`（`target_user_not_resolvable`）を返す。** 黙って先頭を選ぶと、利用者を増やした瞬間に別人の予定を返しうるため。複数ユーザーを扱う必要が出た時点で対応表を導入する。

## `GET /api/internal/schedule`

指定した日の予定・タスク・日付リマインド・移動を、日ごとに束ねて返す。

日ごとの振り分けと並び順は、カレンダー画面と同じ関数（`src/components/calendar/item-layout.ts` の `createCalendarDateUtils`）を通している。ここを書き直すと、同じ日を画面で見たときと違う結果が返る。

### クエリパラメータ

| 名前 | 既定 | 内容 |
| --- | --- | --- |
| `date` | 設定タイムゾーンでの今日 | `YYYY-MM-DD`。返す範囲の初日。形式が不正、または実在しない日付（`2026-02-30` のような繰り上がりを含む）なら `400` |
| `days` | `1` | 1〜31の整数。`date` から何日ぶん返すか。範囲外・整数でなければ `400` |
| `overdueDays` | `30` | 0〜90の整数。期限切れタスクを何日前まで遡るか。`0` で取りにいかない（Notionへの往復が1回減る）。範囲外・整数でなければ `400` |

> **基準日は渡さなくてよい。** VPSのタイムゾーンはUTCだが、DaySpanは日付の解釈に利用者の設定タイムゾーン（`UiSetting.timeZone`、既定 `Asia/Tokyo`）を使うため、省略時の「今日」もそのタイムゾーンで決まる。呼び出し側でJSTの日付を作る必要はない。

### レスポンス

```jsonc
{
  "generatedAt": "2026-08-19T21:00:00.000Z",
  "timeZone": "Asia/Tokyo",
  "range": { "from": "2026-08-19", "to": "2026-08-19" },
  "sources": {
    "googleConnected": true,   // Googleアカウントを1つ以上接続しているか
    "notionReady": true,       // NotionのタスクDBが設定済みか
    "reminderReady": true      // Notionの日付リマインドDBが設定済みか
  },
  "days": [
    {
      "date": "2026-08-19",
      "events": [
        {
          "id": "abc123",
          "title": "定例会",
          "allDay": false,
          "start": "2026-08-19T01:00:00Z",   // 終日は YYYY-MM-DD
          "end": "2026-08-19T02:00:00Z",
          "startTime": "10:00",               // 設定タイムゾーンでの HH:MM。終日は null
          "endTime": "11:00",
          "location": "渋谷オフィス",
          "description": null,
          "calendarName": "仕事",
          "recurring": true,
          "url": "https://www.google.com/calendar/event?eid=..."
        }
      ],
      "tasks": [
        {
          "id": "notion-page-id",
          "title": "請求書を出す",
          "field": "due",                     // due（期限）| planned（予定日）
          "date": "2026-08-19T05:00:00Z",
          "hasTime": true,
          "time": "14:00",                    // 時刻なしは null
          "priority": "高",
          "tags": ["仕事"],
          "memo": null,
          "url": "https://www.notion.so/..."
        }
      ],
      "reminders": [
        {
          "id": "notion-page-id:2026-08-19",  // 毎年の項目を展開した回は元ページのIDと異なる
          "title": "誕生日",
          "date": "2026-08-19",
          "hasTime": false,
          "time": null,
          "category": "記念日",
          "annual": true,                     // 判断できないときは null
          "source": "reminder",               // reminder | garbage（ゴミの収集日）
          "memo": null,
          "url": "https://www.notion.so/..."
        }
      ],
      "travels": [
        {
          "id": "cuid",
          "title": "自宅 → 渋谷",
          "origin": "自宅",
          "destination": "渋谷",
          "mode": "PUBLIC_TRANSIT",            // CAR|PUBLIC_TRANSIT|WALK|OTHER（旧: TRAIN|CAR|BUS|WALK|BICYCLE|PLANE|OTHER。issue #538で公共交通へ統合）
          "start": "2026-08-19T00:30:00Z",
          "end": "2026-08-19T01:00:00Z",
          "startTime": "09:30",
          "endTime": "10:00",
          "estimated": true,                  // 所要時間が手入力ではないかどうか（AI / 経路検索 / Yahoo!乗換案内）
          "returnLeg": false,
          "note": null
        }
      ]
    }
  ],
  "overdueTasks": [
    {
      "id": "notion-page-id",
      "title": "先週の報告書",
      "due": "2026-08-14",
      "hasTime": false,
      "time": null,
      "daysOverdue": 5,                       // range.from から見て何日過ぎているか
      "priority": null,
      "tags": [],
      "url": "https://www.notion.so/..."
    }
  ],
  "errors": []                                // 空なら全て取れている
}
```

型は `src/types/internal-api.ts` にある。呼び出し元へそのまま写して使える。

### 並び順・振り分けの決まり

- **日ごとの並びは、その日に見えている開始時刻の順。** 終日が先頭、同時刻はタイトル順
- **日をまたぐ予定は、かかっている日すべてに出る。** その日の範囲へ切り詰め、前日から続いていれば `startTime` は `00:00`、翌日へ続くなら `endTime` は `24:00`。切り詰めずに元の時刻を返すと、呼び出し元が日付まで見比べないと当日の時間帯を決められない
- **終日予定は `startTime` / `endTime` が `null`。** `start` / `end` は `YYYY-MM-DD`
- **1つのタスクは期限と予定日で2枠に現れる**（`field` で区別する）。日時が完全に同じときは期限の1枠にまとめる（docs/spec.md §5）
- **完了済みのタスクは返らない。** 取得元（`listTasksInRange()`）が除いている

### 期限切れタスク（`overdueTasks`）

`range.from` より前に期限があり、範囲内の日には現れない未完了タスク。範囲内にも出るタスク（期限は過ぎているが予定日が今日、など）は `days` 側にだけ入れる。同じタスクを「今日やること」と「積み残し」の両方へ出しても、読む側で件数が水増しされるだけのため。

遡るのは既定で **30日**まで（`overdueDays` で0〜90に変えられる）。半年前に期限が過ぎたタスクを朝に読み上げても行動は変わらず、遡る範囲を広げるほどNotionの応答が重くなる。

**この遡りぶんは、カレンダーの取得とは別のNotionへの1回で取る。** カレンダーの取得範囲そのものを過去へ広げると、同じ範囲がGoogleと移動へも渡り、タスク1種類のために表示中のカレンダー全部の予定を毎回その日数ぶん取ることになる（docs/spec.md §20「外部APIへ過剰なアクセスを発生させない」）。予定の取得とは並行に投げるため、待ち時間は増えない。

### 連携が設定されていないとき（`sources`）

Google未接続・NotionのDB未設定は「失敗」ではないため `errors` には出ず、該当する配列が空で返る。**これだけでは「今日は何も無い」と区別が付かない**ため、連携そのものの状態を `sources` に添える。呼び出し元は `sources.googleConnected` が `false` なら「予定は取得できていない」と伝えられる。

### 外部サービスが落ちているとき

**取れたぶんを返し、失敗は `errors` に載せる（HTTPは200）。** 全体を失敗させると、Notionが落ちているだけの日にGoogleの予定まで読めなくなる。呼び出し元は `errors` を見て「予定は取れなかった」と伝えられる。

```jsonc
"errors": [
  { "source": "google", "reason": "example@gmail.com の「仕事」の予定を取得できませんでした。" },
  { "source": "notion", "reason": "Notionのタスク・日付リマインド・ゴミの日を取得できませんでした。" }
]
```

DaySpan自身のDBを引けなかったときだけは、取れたぶんという概念が無いため `503`（`internal_api_failed`）を返す。

## `POST /api/internal/notifications/dispatch`

通知の送信を1回ぶん走らせる（docs/spec.md §32・docs/notifications.md）。時刻が来た下書きを送り、
必要なら次の下書きを作り直す。

通常はアプリ内のタイマー（`src/instrumentation.ts`）が毎分呼ぶため、**外から叩く必要は無い。**
この入口を別に置いているのは、手で確かめられるようにするためと、将来VPSのcronから叩く形へ
移せるようにするため。二重に走っても、送信済みの印を送る前に立てているため同じ通知は2回送られない。

応答は `{ "ok": true }`。送った件数は返さない（呼び出し元がそれで分岐する場面が無く、
返すと「何件送られるはず」を呼び出し元が持つことになる）。

```bash
curl -s -X POST -H "Authorization: Bearer $INTERNAL_API_KEY" \
  "http://127.0.0.1:3113/api/internal/notifications/dispatch"
```

## 動作確認

```bash
curl -s -H "Authorization: Bearer $INTERNAL_API_KEY" \
  "http://127.0.0.1:3113/api/internal/schedule" | jq .

# 明日から3日ぶん
curl -s -H "Authorization: Bearer $INTERNAL_API_KEY" \
  "http://127.0.0.1:3113/api/internal/schedule?date=2026-08-20&days=3" | jq '.range, [.days[].date]'

# 期限切れタスクを取りにいかない（Notionへの往復が1回減る）
curl -s -H "Authorization: Bearer $INTERNAL_API_KEY" \
  "http://127.0.0.1:3113/api/internal/schedule?overdueDays=0" | jq '.sources, .overdueTasks'

# 認証エラー（401 が返る）
curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:3113/api/internal/schedule"
```

ローカル開発では `.env.local` に `INTERNAL_API_KEY` を設定する（本番の値は使わない）。ポートは `pnpm dev` の `PORT`。

## 環境変数の配線

| 場所 | 設定 |
| --- | --- |
| 1Password | `apps/dayspan` の `internal-api-key` フィールド（**正**） |
| GitHub Secret | `INTERNAL_API_KEY`。`scripts/sync-github-secrets.sh --only INTERNAL_API_KEY` で1Passwordから同期する |
| 対応表 | `.github/secrets-manifest.tsv` |
| 本番 `.env` | `.github/workflows/deploy.yml` が `update_env` で書き込む |

キーを更新するときは、1Passwordの値を変えてから `sync-github-secrets.sh` を実行し、再デプロイする。**呼び出し元（AIDE）側の値も同時に更新しないと連携が止まる。**
