import React from "react";
import { Composition } from "remotion";
import { StoryVideo } from "./StoryVideo";
import { ReelVideo } from "./ReelVideo";

const defaultStoryProps = {
  heroUrl: "https://machi-event-cho.netlify.app/images/heroes/evt_sample.webp",
  eventImages: [] as string[],
  title: "サンプルイベント",
  tagline: "",
  dateLine: "3/26（木） 11:00-15:00",
  area: "下関市",
  location: "ほっこりカフェ",
  sourceAccount: "sample_account",
};

const defaultReelProps = {
  ...defaultStoryProps,
  mapDuration: 135,
  mapZoomLevels: [] as string[],
  catchphrase: "山口県で注目のイベント！",
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="StoryVideo"
        // @ts-expect-error Remotion v4 typing mismatch
        component={StoryVideo}
        durationInFrames={390}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={defaultStoryProps}
      />
      <Composition
        id="ReelVideo"
        // @ts-expect-error Remotion v4 typing mismatch
        component={ReelVideo}
        durationInFrames={525}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={defaultReelProps}
      />
    </>
  );
};
