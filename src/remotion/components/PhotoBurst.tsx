import React from "react";
import { useCurrentFrame, interpolate, Img } from "remotion";
import { EXTREME_EASE_IN_OUT } from "../easing";

/**
 * 写真が1枚ずつ中央にスライドアップ+ディゾルブで重なるスタック。
 * サイズ変化なし。ease-in-out で下から上にシュッと登場。
 */

// 各写真の微回転（重なったとき自然）
const ROTATIONS = [-2.5, 1.8, -1.2, 3];
// 微妙なオフセット（完全重なり防止）
const OFFSETS = [
  { x: 0, y: 0 },
  { x: 15, y: -10 },
  { x: -10, y: 8 },
  { x: 18, y: -15 },
];

interface PhotoStackProps {
  images: string[];
  enterFrame: number;
  stagger: number;
  fadeOutStart: number;
  fadeOutEnd: number;
}

export const PhotoStack: React.FC<PhotoStackProps> = ({
  images,
  enterFrame,
  stagger,
  fadeOutStart,
  fadeOutEnd,
}) => {
  const frame = useCurrentFrame();
  const count = Math.min(images.length, 4);
  if (count === 0) return null;

  // 全体フェードアウト（オーバーレイと同時）
  const fadeOut = interpolate(frame, [fadeOutStart, fadeOutEnd], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // キャンバス1080x1920に対して約90%幅で大きく表示
  const photoW = 900;
  const photoH = 675;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: fadeOut,
      }}
    >
      {images.slice(0, count).map((src, i) => {
        const photoStart = enterFrame + i * stagger;
        const animDuration = 10; // 10f (0.33秒) でシュッと登場

        // スライドアップ: ease-in-out で下→定位置
        const slideProgress = interpolate(
          frame,
          [photoStart, photoStart + animDuration],
          [0, 1],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: EXTREME_EASE_IN_OUT,
          }
        );
        const translateY = interpolate(slideProgress, [0, 1], [60, 0]);

        // ディゾルブ: 同じ区間で不透明度 0→1
        const opacity = interpolate(
          frame,
          [photoStart, photoStart + animDuration],
          [0, 1],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }
        );

        const rotation = ROTATIONS[i % ROTATIONS.length];
        const offset = OFFSETS[i % OFFSETS.length];

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              width: photoW,
              height: photoH,
              transform: `translate(${offset.x}px, ${offset.y + translateY}px) rotate(${rotation}deg)`,
              borderRadius: 16,
              border: "3px solid rgba(255,255,255,0.9)",
              boxShadow: "0 6px 24px rgba(0,0,0,0.25)",
              overflow: "hidden",
              opacity,
              zIndex: i,
            }}
          >
            <Img
              src={src}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
              }}
            />
          </div>
        );
      })}
    </div>
  );
};
