import { ImageResponse } from "next/og";

import { APP_ICON_BACKGROUND, AppIconGlyph } from "@/lib/app-icon-glyph";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
        <AppIconGlyph size={size.width * 0.7} />
      </div>
    ),
    size,
  );
}
