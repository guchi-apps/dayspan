import { isApnsEnvironment } from "@/lib/apns/send";
import {
  resolveActivityStopUserId,
  shortcutError,
  shortcutJson,
} from "@/app/api/shortcuts/shared";
import {
  isValidLiveActivityToken,
  saveLiveActivityToken,
} from "@/services/live-activity/devices";

type Body = { token?: string; environment?: string };

/**
 * アプリが受け取ったactivity push tokenを登録する（issue #971）。
 *
 * push-to-startで裏起動されたアプリにはWebViewが無く、Cookieのセッションでは呼べない。
 * そのため停止専用トークンをBearerにして、アプリがURLSessionで直接送る。
 */
export async function POST(request: Request) {
  const auth = await resolveActivityStopUserId(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as Body | null;
  const token = body?.token?.trim();
  if (!token || !isValidLiveActivityToken(token)) {
    return shortcutError(400, "invalid_token", "トークンが読めませんでした。");
  }
  if (!isApnsEnvironment(body?.environment)) {
    return shortcutError(400, "invalid_environment", "environment が読めませんでした。");
  }

  await saveLiveActivityToken(auth.userId, { token, environment: body.environment });
  return shortcutJson({ ok: true, message: "登録しました。" });
}
