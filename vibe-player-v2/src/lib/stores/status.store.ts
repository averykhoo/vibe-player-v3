// vibe-player-v2/src/lib/stores/status.store.ts
import {writable} from "svelte/store";
import type {StatusState} from "$lib/types/status.types";

const initialState: StatusState = {
    message: null,
    type: null,
    isLoading: false,
    details: null,
    progress: null,
};

export const statusStore = writable<StatusState>(initialState);
