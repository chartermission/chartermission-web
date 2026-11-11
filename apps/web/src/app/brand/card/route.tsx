/** @jsxImportSource react */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

/*
 * A generated 1200×630 share card for links that have no picture of their own (an event without a
 * cover, a page without a logo, an opportunity…): Charter Mission branding, what the link is, its
 * title and a line of detail. Used by the link-preview page; ?kind=&title=&detail=.
 */

const clip = (value: string | null, max: number) => {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

let assets: Promise<{ mark: string; map: string }> | null = null;
function loadAssets() {
  assets ??= (async () => {
    const dir = path.join(process.cwd(), "public", "brand");
    const [mark, map] = await Promise.all([
      readFile(path.join(dir, "charter-mission-mark.png")),
      readFile(path.join(dir, "africa-network.png")),
    ]);
    return {
      mark: `data:image/png;base64,${mark.toString("base64")}`,
      map: `data:image/png;base64,${map.toString("base64")}`,
    };
  })();
  return assets;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const kind = clip(params.get("kind"), 30);
  const title = clip(params.get("title"), 90) || "Charter Mission";
  const detail = clip(params.get("detail"), 140);
  const { mark, map } = await loadAssets();

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: "#024a22",
        color: "#ffffff",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: 16,
          height: 630,
          background: "#ed0918",
          display: "flex",
        }}
      />
      <img
        src={map}
        width={430}
        height={445}
        style={{ position: "absolute", right: 40, top: 92, opacity: 0.22 }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          padding: "64px 72px 56px 88px",
          width: "100%",
          height: "100%",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <img src={mark} width={64} height={64} style={{ borderRadius: 14 }} />
          <div style={{ fontSize: 34, fontWeight: 700, display: "flex" }}>
            <span>Charter</span>
            <span style={{ color: "#ff9a1f", marginLeft: 10 }}>Mission</span>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flexGrow: 1,
            justifyContent: "center",
            maxWidth: 860,
          }}
        >
          {kind ? (
            <div
              style={{
                display: "flex",
                fontSize: 26,
                letterSpacing: 3,
                textTransform: "uppercase",
                color: "#ff9a1f",
                marginBottom: 18,
              }}
            >
              {kind}
            </div>
          ) : null}
          <div
            style={{
              display: "flex",
              fontSize: title.length > 60 ? 54 : 66,
              fontWeight: 700,
              lineHeight: 1.12,
            }}
          >
            {title}
          </div>
          {detail ? (
            <div
              style={{
                display: "flex",
                fontSize: 30,
                lineHeight: 1.35,
                marginTop: 24,
                color: "#e6f1ea",
              }}
            >
              {detail}
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", fontSize: 24, color: "#e6f1ea" }}>
          chartermission.com
        </div>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      headers: { "Cache-Control": "public, max-age=86400, s-maxage=86400" },
    },
  );
}
