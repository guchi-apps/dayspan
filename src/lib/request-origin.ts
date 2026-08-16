import { headers } from "next/headers";

/**
 * Next.jsのrequest.url(nextUrl.origin)は、開発サーバーがWSL LAN経由・sslip.io経由など
 * 複数のホストから到達可能な場合、実際のブラウザのHostヘッダーを反映せずdevサーバーの
 * デフォルトホスト名を返すことがある。OAuthのリダイレクト先を組み立てる際は、実際に
 * リクエストされたHostヘッダーから明示的にoriginを組み立てる必要がある。
 *
 * 受け取るのは NextRequest ではなく Request。ルートハンドラの引数は素の Request で、
 * ここで見ているのは Request にもある headers と url だけのため。
 */
export function getRequestOrigin(request: Request): string {
  const host = request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "http";

  if (host) {
    return `${proto}://${host}`;
  }

  return new URL(request.url).origin;
}

/**
 * サーバーコンポーネントからのorigin。NextRequestを受け取れない場所で使う。
 *
 * ウィジェットの台本に埋め込むURLは、利用者がいま開いているアドレスから作る。環境変数に
 * 持たせると、開発サーバー・LAN経由・本番でそれぞれ別の値が要り、どれか1つしか正しくならない。
 */
export async function getOriginFromHeaders(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? "http";

  return host ? `${proto}://${host}` : "";
}
