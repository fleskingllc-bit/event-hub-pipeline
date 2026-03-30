import React from "react";
import { useCurrentFrame, interpolate } from "remotion";
import { EXTREME_EASE_IN_OUT } from "../easing";

interface TextRevealProps {
  text: string;
  enterFrame: number;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  lineHeight?: number;
  maxWidth?: number;
  slideDistance?: number;
  duration?: number;
}

export const TextReveal: React.FC<TextRevealProps> = ({
  text,
  enterFrame,
  fontSize = 64,
  fontWeight = 900,
  color = "#fff",
  lineHeight = 1.35,
  maxWidth = 900,
  slideDistance = 60,
  duration = 18,
}) => {
  const frame = useCurrentFrame();

  const progress = interpolate(
    frame,
    [enterFrame, enterFrame + duration],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: EXTREME_EASE_IN_OUT,
    }
  );

  const translateY = interpolate(progress, [0, 1], [slideDistance, 0]);
  const opacity = interpolate(progress, [0, 0.4], [0, 1], {
    extrapolateRight: "clamp",
  });

  // 呼吸アニメーション（120f以降）
  const breathe =
    frame >= 120
      ? interpolate(
          Math.sin(((frame - 120) / 40) * Math.PI * 2),
          [-1, 1],
          [0.98, 1.0]
        )
      : 1;

  return (
    <div
      style={{
        fontSize,
        fontWeight,
        color,
        lineHeight,
        maxWidth,
        textAlign: "center",
        textShadow: "0 4px 20px rgba(0,0,0,0.5)",
        transform: `translateY(${translateY}px) scale(${breathe})`,
        opacity,
        letterSpacing: "0.02em",
      }}
    >
      {text}
    </div>
  );
};
