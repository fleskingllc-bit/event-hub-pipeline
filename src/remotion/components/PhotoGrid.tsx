import React from "react";
import { useCurrentFrame, interpolate, Img } from "remotion";
import { EXTREME_EASE_IN_OUT } from "../easing";

/**
 * 最終シーンで写真をグリッド表示。
 * 1枚: 中央大きめ
 * 2枚: 左右並び
 * 3枚: 上段2枚 + 下段1枚中央
 * 4枚: 2×2グリッド
 */

interface PhotoGridProps {
  images: string[];
  enterFrame: number;
}

export const PhotoGrid: React.FC<PhotoGridProps> = ({ images, enterFrame }) => {
  const frame = useCurrentFrame();
  const count = Math.min(images.length, 4);
  if (count === 0) return null;

  // 全体フェードイン
  const opacity = interpolate(frame, [enterFrame, enterFrame + 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EXTREME_EASE_IN_OUT,
  });

  const gap = 16;
  const padding = 60;
  const availW = 1080 - padding * 2;

  // レイアウト計算
  const getGridStyle = (): {
    containerStyle: React.CSSProperties;
    items: { w: number; h: number }[];
  } => {
    if (count === 1) {
      const w = availW * 0.7;
      const h = w * 0.75;
      return {
        containerStyle: {
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        },
        items: [{ w, h }],
      };
    }
    if (count === 2) {
      const w = (availW - gap) / 2;
      const h = w * 0.75;
      return {
        containerStyle: {
          display: "flex",
          gap,
          justifyContent: "center",
          alignItems: "center",
        },
        items: [
          { w, h },
          { w, h },
        ],
      };
    }
    if (count === 3) {
      const topW = (availW - gap) / 2;
      const topH = topW * 0.75;
      const botW = topW;
      const botH = topH;
      return {
        containerStyle: {
          display: "flex",
          flexDirection: "column",
          gap,
          alignItems: "center",
        },
        items: [
          { w: topW, h: topH },
          { w: topW, h: topH },
          { w: botW, h: botH },
        ],
      };
    }
    // 4枚: 2×2
    const cellW = (availW - gap) / 2;
    const cellH = cellW * 0.75;
    return {
      containerStyle: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap,
        justifyItems: "center",
        alignItems: "center",
      },
      items: Array(4).fill({ w: cellW, h: cellH }),
    };
  };

  const { containerStyle, items } = getGridStyle();

  // 3枚は上段と下段に分ける
  if (count === 3) {
    const topRow = images.slice(0, 2);
    const botRow = images.slice(2, 3);
    return (
      <div
        style={{
          position: "absolute",
          bottom: 200,
          left: padding,
          right: padding,
          opacity,
          display: "flex",
          flexDirection: "column",
          gap,
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", gap, justifyContent: "center" }}>
          {topRow.map((src, i) => (
            <div
              key={i}
              style={{
                width: items[i].w,
                height: items[i].h,
                borderRadius: 12,
                overflow: "hidden",
                border: "2px solid rgba(255,255,255,0.8)",
                boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
              }}
            >
              <Img
                src={src}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
              />
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap, justifyContent: "center" }}>
          {botRow.map((src, i) => (
            <div
              key={i + 2}
              style={{
                width: items[2].w,
                height: items[2].h,
                borderRadius: 12,
                overflow: "hidden",
                border: "2px solid rgba(255,255,255,0.8)",
                boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
              }}
            >
              <Img
                src={src}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        bottom: 200,
        left: padding,
        right: padding,
        opacity,
        ...containerStyle,
      }}
    >
      {images.slice(0, count).map((src, i) => (
        <div
          key={i}
          style={{
            width: items[i].w,
            height: items[i].h,
            borderRadius: 12,
            overflow: "hidden",
            border: "2px solid rgba(255,255,255,0.8)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
          }}
        >
          <Img
            src={src}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        </div>
      ))}
    </div>
  );
};
