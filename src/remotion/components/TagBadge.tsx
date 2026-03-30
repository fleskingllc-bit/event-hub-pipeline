import React from "react";
import { useCurrentFrame, interpolate } from "remotion";
import { EXPLOSIVE_OUT } from "../easing";

interface TagBadgeProps {
  text: string;
  gradient: string;
  enterFrame: number;
  delay?: number;
}

export const TagBadge: React.FC<TagBadgeProps> = ({
  text,
  gradient,
  enterFrame,
  delay = 0,
}) => {
  const frame = useCurrentFrame();
  const startFrame = enterFrame + delay;

  const progress = interpolate(frame, [startFrame, startFrame + 6], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EXPLOSIVE_OUT,
  });

  const scale = interpolate(progress, [0, 1], [0.3, 1]);
  const opacity = interpolate(progress, [0, 0.3], [0, 1], {
    extrapolateRight: "clamp",
  });

  // シマーアニメーション（120f以降）
  const shimmer =
    frame >= 120
      ? interpolate(
          Math.sin(((frame - 120) / 30) * Math.PI * 2),
          [-1, 1],
          [0.9, 1.0]
        )
      : 1;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "18px 42px",
        borderRadius: 30,
        background: gradient,
        color: "#fff",
        fontSize: 42,
        fontWeight: 700,
        letterSpacing: "0.04em",
        transform: `scale(${scale * shimmer})`,
        opacity,
        boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
      }}
    >
      {text}
    </div>
  );
};
