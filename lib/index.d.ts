import { Context, Schema, Session } from 'koishi';

export type Platform = 'netease' | 'qq';

export interface Config {
  platform?: Platform;
  imageMode?: boolean;
  showWarning?: boolean;
}

export interface SongData {
  songname: string;
  name: string;
}

export declare const Config: Schema<Config>;

export declare const name = "music-downloadvoice-api";

export declare function fetchSongData(apiBase: string, keyword: string, n?: number): Promise<any>;

export declare function fetchQQSongData(keyword: string, n?: number): Promise<any>;

export declare function fetchNetEaseSongData(keyword: string, n?: number): Promise<any>;

export declare function formatSongList(songList: SongData[], platform: string, startIndex: number): string;

export declare function apply(ctx: Context, config: Config): void;
