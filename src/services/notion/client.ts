import { Client, type QueryDataSourceParameters } from "@notionhq/client";
import type { NotionConnection } from "@prisma/client";

import { decryptSecret } from "@/lib/crypto/secret-cipher";

/**
 * ユーザーのNotion接続からクライアントを組み立てる。
 * トークンはユーザーごとにDBへ暗号化保存しているため、環境変数からは読まない
 * （将来のNotion OAuthへ差し替えるときも、ここだけを変えれば済むようにしている）。
 */
export function createNotionClient(connection: NotionConnection): Client {
  return new Client({ auth: decryptSecret(connection.accessToken) });
}

export function createNotionClientFromToken(token: string): Client {
  return new Client({ auth: token });
}

/**
 * データソースの検索条件。
 *
 * `Record<string, unknown>` で受けて `as never` で流し込むと、Notionが受け付けない形の条件が
 * 型検査を素通りする。実際にそれで3段のネストが本番まで届き、勤務の画面が開けなくなった
 * （issue #402）。組み立ての時点で弾けるよう、SDKの型のまま持ち回る。
 */
export type NotionQueryFilter = QueryDataSourceParameters["filter"];

/**
 * 複合フィルタ（`or` / `and`）の要素。
 *
 * 中に置けるのはプロパティ1つか、その1段下の複合フィルタまで。Notionの複合フィルタは
 * 2段までしかネストできず、3段を送ると400（validation_error）が返る。
 */
export type NotionFilterGroup = Extract<
  NonNullable<NotionQueryFilter>,
  { or: unknown }
>["or"][number];
