import { ImageResponse } from "next/og";

import { APP_ICON_BACKGROUND, AppIconGlyph } from "@/lib/app-icon-glyph";

const SIZE = 512;

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: APP_ICON_BACKGROUND,
        }}
      >
        <AppIconGlyph size={SIZE * 0.7} />
      </div>
    ),
    { width: SIZE, height: SIZE },
  );
}
