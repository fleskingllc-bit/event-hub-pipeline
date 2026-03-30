import React from "react";
import { Series } from "remotion";
import { MapZoomAnimation } from "./components/MapZoomAnimation";
import { StoryVideo } from "./StoryVideo";
import type { ReelVideoProps } from "./types";

export const ReelVideo: React.FC<ReelVideoProps> = ({
  mapDuration = 135,
  mapZoomLevels,
  catchphrase,
  ...storyProps
}) => {
  const storyDuration = 390;

  return (
    <Series>
      <Series.Sequence durationInFrames={mapDuration}>
        <MapZoomAnimation
          area={storyProps.area}
          eventTitle={storyProps.title}
          catchphrase={catchphrase}
          mapZoomLevels={mapZoomLevels}
          durationInFrames={mapDuration}
        />
      </Series.Sequence>
      <Series.Sequence durationInFrames={storyDuration}>
        <StoryVideo {...storyProps} />
      </Series.Sequence>
    </Series>
  );
};
