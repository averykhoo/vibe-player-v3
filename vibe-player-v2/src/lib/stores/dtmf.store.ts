// vibe-player-v2/src/lib/stores/dtmf.store.ts

import {writable} from "svelte/store";

export interface DtmfState {
    status: "idle" | "processing" | "complete" | "error";
    dtmf: string[];
    cpt: string[]; // For Call Progress Tones
    error: string | null;
}

const initialState: DtmfState = {
    status: "idle",
    dtmf: [],
    cpt: [],
    error: null,
};

export const dtmfStore = writable<DtmfState>(initialState);
