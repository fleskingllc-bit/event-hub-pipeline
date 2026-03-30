export interface StoryVideoProps {
  heroUrl: string;
  eventImages: string[];
  title: string;
  tagline: string;
  dateLine: string;
  area: string;
  location: string;
  sourceAccount: string;
}

export interface ReelVideoProps extends StoryVideoProps {
  /** MapZoomAnimation の前半フレーム数 */
  mapDuration?: number;
  /** 地図ズームレベル別スクリーンショット [z7, z9, z11, z13, z15] */
  mapZoomLevels: string[];
  /** マップ冒頭のキャッチコピー */
  catchphrase: string;
}
