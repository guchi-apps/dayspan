import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { searchPlace } from "@/services/geocoding/nominatim";
import { resolvePointAddress } from "@/services/geocoding/resolve-point";

/**
 * 地図から場所を登録するときの住所引き（docs/spec.md §9）。
 *
 * `?lat=&lon=` で地点から住所を、`?q=` で地名から地点を引く。ブラウザから直接Nominatim・
 * Overpassを呼ばないのは、どちらも呼び出し元を名乗るUser-Agentを求めており、ブラウザの
 * fetchでは差し替えられないため。
 */
export async function GET(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim();
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  const hasPoint = Number.isFinite(lat) && Number.isFinite(lon);

  if (!query && !hasPoint) {
    return NextResponse.json({ error: "q or lat/lon is required" }, { status: 400 });
  }

  try {
    // 地点が来ていればそちらを優先する。地名より確かな指定であるため。
    const place = hasPoint ? await resolvePointAddress(lat, lon) : await searchPlace(query!);
    return NextResponse.json({ place });
  } catch (error) {
    return externalApiError("osm", "住所の取得", error);
  }
}
