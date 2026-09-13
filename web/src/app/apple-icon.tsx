import { ImageResponse } from "next/og";

// Apple touch icons must be raster — Safari does not accept SVG here, so
// an apple-icon.svg is simply not served (it 404s). Generated as a PNG
// instead, full-bleed because iOS composites and rounds it itself.
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
          background: "#1B3A6B",
          color: "#FFFFFF",
          fontSize: 104,
          fontWeight: 700,
          fontFamily: "sans-serif",
        }}
      >
        m
      </div>
    ),
    size
  );
}
