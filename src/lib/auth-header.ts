/**
 * proxy.ts が検証したSupabaseユーザーIDを、後段のページ・ルートハンドラへ渡すためのヘッダー。
 *
 * proxy.ts はmatcherに一致するすべてのリクエストでこの値を必ず上書きし、未ログインなら削除する。
 * そのため、クライアントが同名のヘッダーを詐称して送ってきても後段には届かない。
 * この前提はmatcherに一致しないパスには及ばないため、`/api/` はmatcherの除外条件から
 * 外す必要がある（proxy.ts のコメント・issue #839）。
 */
export const SUPABASE_USER_ID_HEADER = "x-dayspan-supabase-user-id";
