import assert from "node:assert/strict";
import test from "node:test";

import { parseGoogleMapsRouteUrl } from "@/lib/google-maps-route";

test("共有された経路URLから座標・交通手段・出発日時を読む", () => {
  assert.deepEqual(
    parseGoogleMapsRouteUrl(
      "https://www.google.com/maps/dir/34.841753,135.61853/34.552378,135.496285/data=!4m11!8j1791103500!3e0",
    ),
    {
      origin: "34.841753,135.61853",
      destination: "34.552378,135.496285",
      mode: "CAR",
      departAt: "2026-10-04T08:45:00.000Z",
    },
  );
});

test("Google Maps URLs形式と交通手段を読む", () => {
  assert.deepEqual(
    parseGoogleMapsRouteUrl(
      "https://www.google.com/maps/dir/?api=1&origin=東京駅&destination=新大阪駅&travelmode=transit",
    ),
    { origin: "東京駅", destination: "新大阪駅", mode: "PUBLIC_TRANSIT", departAt: null },
  );
});

test("Google以外・経路でないURLは読まない", () => {
  assert.equal(parseGoogleMapsRouteUrl("https://example.com/maps/dir/a/b"), null);
  assert.equal(parseGoogleMapsRouteUrl("https://www.google.com/maps/search/東京駅"), null);
  assert.equal(parseGoogleMapsRouteUrl("not a url"), null);
});
