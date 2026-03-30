import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
  Img,
} from "remotion";
import { EXTREME_EASE_IN_OUT } from "../easing";

interface MapZoomAnimationProps {
  area: string;
  eventTitle: string;
  catchphrase: string;
  /** [z7, z9, z11, z13, z15] の5段キャプチャ */
  mapZoomLevels: string[];
  durationInFrames: number;
}

/**
 * Google Maps風 無限ズームアニメーション（5段階・高速テンポ）
 */
export const MapZoomAnimation: React.FC<MapZoomAnimationProps> = ({
  area,
  eventTitle,
  catchphrase,
  mapZoomLevels,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const STAGE_FRAMES = 13;
  const STAGE_START = 3;

  // --- 5段のズームステージ ---
  const stages = mapZoomLevels.map((_, i) => {
    const start = STAGE_START + i * STAGE_FRAMES;
    const end = start + STAGE_FRAMES;
    const progress = interpolate(frame, [start, end], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: EXTREME_EASE_IN_OUT,
    });
    const scale = interpolate(progress, [0, 1], [1, 4]);
    return { progress, scale, start, end };
  });

  // 各レイヤーのopacity
  const layerOpacities = mapZoomLevels.map((_, i) => {
    let opIn = 1;
    if (i > 0) {
      opIn = interpolate(stages[i - 1].progress, [0.4, 0.85], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
    }
    let opOut = 1;
    if (i < mapZoomLevels.length - 1) {
      opOut = interpolate(stages[i].progress, [0.5, 1], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
    }
    return Math.min(opIn, opOut);
  });

  // --- 最終ステージ: z15 追加ズーム（ピンに向かって） ---
  const lastIdx = mapZoomLevels.length - 1;
  const extraZoomStart = stages[lastIdx].start + 3;
  const extraZoomEnd = extraZoomStart + 18;
  const extraZoom = interpolate(frame, [extraZoomStart, extraZoomEnd], [1, 3], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EXTREME_EASE_IN_OUT,
  });

  // --- ピンドロップ ---
  const pinFrame = extraZoomStart + 5;
  const pinSpring = spring({
    frame: frame - pinFrame,
    fps,
    config: { damping: 7, stiffness: 220, mass: 0.6 },
  });
  const pinY = frame >= pinFrame
    ? interpolate(pinSpring, [0, 1], [-400, 0])
    : -400;
  const pinScale = frame >= pinFrame ? pinSpring : 0;

  // --- エリア名タグ ---
  const areaFrame = pinFrame + 4;
  const areaSpring = spring({
    frame: frame - areaFrame,
    fps,
    config: { damping: 8, stiffness: 180, mass: 0.5 },
  });
  const areaScale = frame >= areaFrame ? areaSpring : 0;

  // --- タイトル「どんっ」 ---
  const titleFrame = areaFrame + 4;
  const titleSpring = spring({
    frame: frame - titleFrame,
    fps,
    config: { damping: 5, stiffness: 180, mass: 0.8 },
  });

  // --- キャッチコピー: フレーム0から即表示、ピンドロップ直前まで ---
  const catchphraseEnd = pinFrame - 2;
  const catchphrasePopIn = spring({
    frame,
    fps,
    config: { damping: 10, stiffness: 250, mass: 0.4 },
  });
  const catchphraseFadeOut = interpolate(
    frame, [catchphraseEnd - 8, catchphraseEnd], [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const catchphraseOpacity = Math.min(catchphrasePopIn, catchphraseFadeOut);

  // --- 白フェードアウト ---
  const fadeOutStart = durationInFrames - 12;
  const fadeOut = interpolate(frame, [fadeOutStart, durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const imgStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    willChange: "transform",
  };

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#e8eff5",
        fontFamily: "'Noto Sans JP', sans-serif",
        overflow: "hidden",
      }}
    >
      <style>
        {`@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700;900&display=swap');`}
      </style>

      {/* 5段のズームレイヤー */}
      {mapZoomLevels.map((src, i) => {
        const isLast = i === lastIdx;
        const layerScale = isLast ? extraZoom : stages[i].scale;

        return (
          <AbsoluteFill
            key={i}
            style={{
              opacity: layerOpacities[i],
            }}
          >
            <Img
              src={src}
              style={{
                ...imgStyle,
                transform: `scale(${layerScale})`,
                transformOrigin: "50% 50%",
              }}
            />
          </AbsoluteFill>
        );
      })}

      {/* キャッチコピー — ズーム中ずっと表示 */}
      {frame < catchphraseEnd && (
        <div
          style={{
            position: "absolute",
            top: "15%",
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
            opacity: catchphraseOpacity,
            transform: `scale(${catchphrasePopIn})`,
            zIndex: 10,
          }}
        >
          <div
            style={{
              background: "rgba(0,0,0,0.75)",
              backdropFilter: "blur(12px)",
              color: "#fff",
              fontSize: 44,
              fontWeight: 900,
              padding: "24px 56px",
              borderRadius: 24,
              letterSpacing: "0.04em",
              textAlign: "center",
              boxShadow: "0 6px 28px rgba(0,0,0,0.4)",
              maxWidth: 900,
            }}
          >
            {catchphrase}
          </div>
        </div>
      )}

      {/* ピンドロップ */}
      {frame >= pinFrame && (
        <div
          style={{
            position: "absolute",
            top: "32%",
            left: "50%",
            transform: `translate(-50%, ${pinY}px) scale(${pinScale})`,
            fontSize: 100,
            filter: "drop-shadow(0 8px 24px rgba(0,0,0,0.4))",
            zIndex: 10,
          }}
        >
          📍
        </div>
      )}

      {/* エリア名タグ */}
      {frame >= areaFrame && (
        <div
          style={{
            position: "absolute",
            top: "46%",
            left: "50%",
            transform: `translate(-50%, -50%) scale(${areaScale})`,
            background: "linear-gradient(135deg, #FF6B6B, #FF8E53)",
            color: "#fff",
            fontSize: 48,
            fontWeight: 900,
            padding: "16px 48px",
            borderRadius: 28,
            boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
            letterSpacing: "0.06em",
            zIndex: 10,
          }}
        >
          {area}
        </div>
      )}

      {/* タイトル「どんっ」 */}
      {frame >= titleFrame && (
        <div
          style={{
            position: "absolute",
            bottom: 340,
            left: 40,
            right: 40,
            textAlign: "center",
            fontSize: 72,
            fontWeight: 900,
            color: "#fff",
            textShadow:
              "0 4px 20px rgba(0,0,0,0.8), 0 0 60px rgba(0,0,0,0.4), 0 0 120px rgba(0,0,0,0.2)",
            transform: `scale(${titleSpring})`,
            zIndex: 10,
          }}
        >
          {eventTitle}
        </div>
      )}

      {/* 白フェードアウト */}
      <AbsoluteFill
        style={{
          backgroundColor: "#fff",
          opacity: fadeOut,
        }}
      />
    </AbsoluteFill>
  );
};
