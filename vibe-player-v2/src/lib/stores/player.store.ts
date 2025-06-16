import {writable} from "svelte/store";
import type {PlayerState} from "$lib/types/player.types";

const initialState: PlayerState = {
    status: "idle",
    fileName: null,
    duration: 0,
    currentTime: 0,
    isPlaying: false,
    isPlayable: false,
    speed: 1.0,
    pitch: 0.0,
    gain: 1.0,
    waveformData: undefined,
    error: null,
    audioBuffer: undefined,
    audioContextResumed: false,
    channels: undefined,
    sampleRate: undefined,
    lastProcessedChunk: undefined,
};

export const playerStore = writable<PlayerState>(initialState);
