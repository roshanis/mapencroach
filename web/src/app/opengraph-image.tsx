import { ImageResponse } from "next/og";

// Generated at request time rather than committed as a binary, so the
// card can never drift from the wording on the page it represents, and
// there is no large PNG in the repo to keep compressed.
//
// NOTE for anyone editing: this is rendered by Satori, not a browser.
// Every element with more than one child needs an explicit `display`,
// and `<br/>` counts as a child — an earlier version used one and the
// route crashed at request time while `next build` still passed.
export const alt =
  "mapencroach — public land intelligence: satellite change signals to evidence-backed due process";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0F2A4A",
          color: "#FFFFFF",
          padding: "72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 56,
              height: 56,
              borderRadius: 12,
              marginRight: 20,
              background: "#1B3A6B",
              fontSize: 30,
              fontWeight: 700,
            }}
          >
            m
          </div>
          <div style={{ display: "flex", fontSize: 30, opacity: 0.85 }}>mapencroach</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 68, fontWeight: 700, letterSpacing: -1.5 }}>
            See land risk early.
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 68,
              fontWeight: 700,
              letterSpacing: -1.5,
              marginTop: 6,
            }}
          >
            Move every case lawfully.
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 28,
              opacity: 0.8,
              marginTop: 24,
              maxWidth: 900,
            }}
          >
            Satellite screening, cadastral truth, field verification and due
            process in one record.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", fontSize: 22, opacity: 0.7 }}>
          <div
            style={{
              display: "flex",
              width: 12,
              height: 12,
              borderRadius: 6,
              marginRight: 14,
              background: "#E8552F",
            }}
          />
          <div style={{ display: "flex" }}>
            Evidence-backed. Jurisdiction-scoped. Audit-chained.
          </div>
        </div>
      </div>
    ),
    size
  );
}
