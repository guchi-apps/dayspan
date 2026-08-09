import { Client } from "@notionhq/client";
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
