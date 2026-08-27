import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import {
  createTravel,
  validateTravelInput,
  type TravelReturnInput,
  type TravelWriteInput,
} from "@/services/travel/plans";

type CreateBody = Partial<TravelWriteInput> & { returnTrip?: TravelReturnInput | null };

/** 移動を作る（docs/spec.md §29）。往復のときは復路も同じ呼び出しで作る。 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json()) as CreateBody;
  const invalid = validateTravelInput(body);
  if (invalid) {
    return NextResponse.json({ error: "invalid_request", message: invalid }, { status: 400 });
  }

  try {
    const result = await createTravel(
      userId,
      {
        origin: body.origin!,
        destination: body.destination!,
        mode: body.mode!,
        departAt: body.departAt!,
        arriveAt: body.arriveAt!,
        note: body.note ?? null,
        estimated: body.estimated ?? false,
        estimateSource: body.estimateSource,
        linkedEventId: body.linkedEventId ?? null,
        linkedCalendarId: body.linkedCalendarId ?? null,
      },
      body.returnTrip ?? null,
    );

    return NextResponse.json(result);
  } catch (error) {
    // 到着が出発より前などの不備はサービス層で例外になる。理由をそのまま画面へ返す。
    const message = error instanceof Error ? error.message : String(error);
    console.error("[dayspan] travel create failed:", message);
    return NextResponse.json({ error: "travel_create_failed", message }, { status: 400 });
  }
}
