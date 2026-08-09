// Google Calendar API用のOAuth。ログイン用のGoogle OAuth（Supabase Auth側、他アプリと共有）とは
// 別クライアントで、カレンダー権限のみを追加取得する（docs/spec.md §17）。
// リフレッシュトークンをDaySpanが自前で保持するため、認可コードフローを直接扱う。

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

// 必要以上に広い権限は要求しない（docs/spec.md §17）。
// calendar.readonly はカレンダー一覧と予定の取得、calendar.events は予定の作成・更新・削除に必要。
export const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

export type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  id_token?: string;
};

function getClientCredentials() {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CALENDAR_CLIENT_ID / GOOGLE_CALENDAR_CLIENT_SECRET is not set");
  }

  return { clientId, clientSecret };
}

export function buildRedirectUri(origin: string): string {
  return `${origin}/api/google/callback`;
}

export function buildAuthUrl({ origin, state }: { origin: string; state: string }): string {
  const { clientId } = getClientCredentials();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: buildRedirectUri(origin),
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPES.join(" "),
    state,
    // リフレッシュトークンを得るために必須。prompt=consent を付けないと、2回目以降の認可で
    // refresh_token が返らずトークン更新ができなくなる。
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });

  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

async function postToken(body: Record<string, string>): Promise<GoogleTokenResponse> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google token endpoint returned ${response.status}: ${detail}`);
  }

  return (await response.json()) as GoogleTokenResponse;
}

export async function exchangeCodeForTokens({
  code,
  origin,
}: {
  code: string;
  origin: string;
}): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret } = getClientCredentials();

  return postToken({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: buildRedirectUri(origin),
    grant_type: "authorization_code",
  });
}

export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret } = getClientCredentials();

  return postToken({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
}

/**
 * IDトークンからGoogleアカウントの識別子とメールアドレスを取り出す。
 * トークンはGoogleのトークンエンドポイントからTLS経由で直接受け取ったものなので、
 * ここでは署名検証を行わない（第三者から渡された値ではない）。
 */
export function parseIdToken(idToken: string): { sub: string; email: string } | null {
  const payload = idToken.split(".")[1];
  if (!payload) return null;

  try {
    const json = Buffer.from(payload, "base64url").toString("utf-8");
    const claims = JSON.parse(json) as { sub?: string; email?: string };
    if (!claims.sub || !claims.email) return null;
    return { sub: claims.sub, email: claims.email };
  } catch {
    return null;
  }
}
