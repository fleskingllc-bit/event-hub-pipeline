import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  Img,
} from "remotion";
import { PhotoStack } from "./components/PhotoBurst";
import { TextReveal } from "./components/TextReveal";
import { TagBadge } from "./components/TagBadge";
import { PhotoGrid } from "./components/PhotoGrid";
import { EXTREME_EASE_IN_OUT } from "./easing";
import type { StoryVideoProps } from "./types";

export const StoryVideo: React.FC<StoryVideoProps> = ({
  heroUrl,
  eventImages,
  title,
  tagline,
  dateLine,
  area,
  location,
  sourceAccount,
}) => {
  const frame = useCurrentFrame();
  const hasPhotos = eventImages.length > 0;

  // --- タイムライン ---
  const photoStagger = 15;
  const photoCount = Math.min(eventImages.length, 4);
  const photosEndFrame = hasPhotos ? 10 + photoCount * photoStagger + 10 : 0;
  const overlayStart = hasPhotos ? photosEndFrame : 10;
  const overlayEnd = overlayStart + 12;
  const tagStart = overlayEnd;
  const titleStart = tagStart + 6;
  const dividerStart = titleStart + 18;
  const locationStart = dividerStart + 5;
  const bottomStart = locationStart + 5;
  const bottomEnd = bottomStart + 20;
  // 写真グリッド: bottomEnd の少し後に登場
  const gridStart = bottomEnd + 10;

  // --- ヒーロー画像 (f0-3) ---
  const heroOpacity = interpolate(frame, [0, 3], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // --- グレーオーバーレイ ---
  const overlayOpacity = interpolate(
    frame,
    [overlayStart, overlayEnd],
    [0, 0.45],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // --- 区切り線 ---
  const dividerWidth = interpolate(
    frame,
    [dividerStart, dividerStart + 10],
    [0, 180],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: EXTREME_EASE_IN_OUT,
    }
  );

  // --- 場所テキスト ---
  const locationOpacity = interpolate(
    frame,
    [locationStart, locationStart + 10],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // --- Bottom section ---
  const bottomProgress = interpolate(frame, [bottomStart, bottomEnd], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EXTREME_EASE_IN_OUT,
  });
  const bottomY = interpolate(bottomProgress, [0, 1], [80, 0]);
  const bottomOpacity = interpolate(bottomProgress, [0, 0.4], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#fff",
        fontFamily: "'Noto Sans JP', sans-serif",
      }}
    >
      <style>
        {`@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700;900&display=swap');`}
      </style>

      {/* ヒーロー画像 */}
      <AbsoluteFill
        style={{
          opacity: heroOpacity,
          transform: "scale(1.8)",
          transformOrigin: "center center",
        }}
      >
        <Img
          src={heroUrl}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
          }}
        />
      </AbsoluteFill>

      {/* 写真スタック */}
      {hasPhotos && (
        <PhotoStack
          images={eventImages}
          enterFrame={10}
          stagger={photoStagger}
          fadeOutStart={overlayStart}
          fadeOutEnd={overlayEnd}
        />
      )}

      {/* グレーオーバーレイ */}
      <AbsoluteFill
        style={{
          backgroundColor: `rgba(0,0,0,${overlayOpacity})`,
        }}
      />

      {/* テキストコンテンツ（上部寄せ） */}
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
          paddingTop: hasPhotos ? 280 : 500,
          paddingLeft: 60,
          paddingRight: 60,
        }}
      >
        {/* タグ */}
        <div
          style={{
            display: "flex",
            gap: 16,
            marginBottom: 32,
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          {area && (
            <TagBadge
              text={area}
              gradient="linear-gradient(135deg, #FF6B6B, #FF8E53)"
              enterFrame={tagStart}
            />
          )}
          {dateLine && (
            <TagBadge
              text={dateLine}
              gradient="linear-gradient(135deg, #667eea, #764ba2)"
              enterFrame={tagStart}
              delay={3}
            />
          )}
        </div>

        {/* タイトル */}
        <TextReveal
          text={title}
          enterFrame={titleStart}
          fontSize={96}
          fontWeight={900}
        />

        {/* 区切り線 */}
        <div
          style={{
            width: dividerWidth,
            height: 3,
            backgroundColor: "rgba(255,255,255,0.6)",
            borderRadius: 2,
            marginTop: 28,
            marginBottom: 28,
          }}
        />

        {/* 場所 */}
        <div
          style={{
            fontSize: 45,
            fontWeight: 400,
            color: "#fff",
            textShadow: "0 2px 12px rgba(0,0,0,0.6)",
            opacity: locationOpacity,
            letterSpacing: "0.03em",
          }}
        >
          {location}
        </div>

        {/* イベント概要 */}
        {tagline && (
          <TextReveal
            text={tagline}
            enterFrame={locationStart + 8}
            fontSize={32}
            fontWeight={400}
            color="#fff"
            lineHeight={1.4}
            maxWidth={860}
            slideDistance={30}
          />
        )}
      </AbsoluteFill>

      {/* 写真グリッド（最終シーン、下部に表示） */}
      {hasPhotos && <PhotoGrid images={eventImages} enterFrame={gridStart} />}

      {/* Bottom bar（写真グリッドがある場合は最下部に） */}
      <div
        style={{
          position: "absolute",
          bottom: hasPhotos ? 40 : 60,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          transform: `translateY(${bottomY}px)`,
          opacity: bottomOpacity,
        }}
      >
        {sourceAccount && (
          <div
            style={{
              fontSize: 36,
              color: "#fff",
              textShadow: "0 2px 8px rgba(0,0,0,0.5)",
            }}
          >
            photo: @{sourceAccount}
          </div>
        )}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            padding: "15px 36px",
            background: "rgba(255,255,255,0.15)",
            backdropFilter: "blur(8px)",
            borderRadius: 12,
            fontSize: 36,
            color: "#fff",
            fontWeight: 700,
            letterSpacing: "0.05em",
          }}
        >
          @machi_ymg
        </div>
      </div>
    </AbsoluteFill>
  );
};
