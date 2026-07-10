import {
  CLIP_CONFIRMATION_WINDOW_MS,
  CLIP_EVENT_RETENTION_MS
} from "./constants";

export interface ClipSignalInput {
  id: string;
  createdAt: number;
}

export interface ClipSignalSnapshot {
  recentClipCount: number;
}

interface ChannelClipState {
  clips: ClipSignalInput[];
  seenClipIds: Map<string, number>;
}

export class ClipSignalTracker {
  private readonly states = new Map<string, ChannelClipState>();

  recordClips(
    channelLogin: string,
    clips: ClipSignalInput[],
    now = Date.now()
  ): number {
    const state = this.getState(channelLogin);
    this.prune(state, now);

    let added = 0;
    for (const clip of clips) {
      if (!clip.id || !Number.isFinite(clip.createdAt)) {
        continue;
      }

      if (state.seenClipIds.has(clip.id)) {
        continue;
      }

      state.seenClipIds.set(clip.id, now);
      state.clips.push(clip);
      added += 1;
    }

    this.prune(state, now);
    return added;
  }

  getSnapshot(channelLogin: string, now = Date.now()): ClipSignalSnapshot {
    const state = this.getState(channelLogin);
    this.prune(state, now);

    const minCreatedAt = now - CLIP_CONFIRMATION_WINDOW_MS;
    const recentClipCount = state.clips.filter(
      (clip) => clip.createdAt >= minCreatedAt && clip.createdAt <= now
    ).length;

    return {
      recentClipCount
    };
  }

  clear(channelLogin?: string): void {
    if (channelLogin) {
      this.states.delete(channelLogin);
      return;
    }

    this.states.clear();
  }

  private getState(channelLogin: string): ChannelClipState {
    const existing = this.states.get(channelLogin);
    if (existing) {
      return existing;
    }

    const created: ChannelClipState = {
      clips: [],
      seenClipIds: new Map()
    };
    this.states.set(channelLogin, created);
    return created;
  }

  private prune(state: ChannelClipState, now: number): void {
    const minTimestamp = now - CLIP_EVENT_RETENTION_MS;
    state.clips = state.clips.filter((clip) => clip.createdAt >= minTimestamp);

    for (const [clipId, seenAt] of state.seenClipIds) {
      if (seenAt < minTimestamp) {
        state.seenClipIds.delete(clipId);
      }
    }
  }
}
