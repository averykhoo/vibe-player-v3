import { goto } from '$app/navigation';
import { page } from '$app/stores';
import { get } from 'svelte/store'; // To get current value of page store

// Assuming placeholder stores for now. Actual structure might differ.
import { playerStore } from '../stores/player.store';
import { analysisStore } from '../stores/analysis.store';

import { debounce } from './async';
import { URL_HASH_KEYS, UI_CONSTANTS } from './constants';

// This flag prevents updating the URL when the stores are initially set from the URL parameters.
let hasInitializedFromUrl = false;

// Placeholder: Actual store structures are not yet defined.
// These interfaces are for conceptual clarity of what we expect.
interface PlayerState {
  speed?: number;
  pitch?: number;
  gain?: number;
  audioUrl?: string;
  currentTime?: number;
}

interface AnalysisState {
  vadPositiveThreshold?: number;
  vadNegativeThreshold?: number;
}

function buildUrlSearchParams(player: PlayerState, analysis: AnalysisState): URLSearchParams {
    const params = new URLSearchParams();
    if (player.speed !== undefined) params.set(URL_HASH_KEYS.SPEED, String(player.speed));
    if (player.pitch !== undefined) params.set(URL_HASH_KEYS.PITCH, String(player.pitch));
    if (player.gain !== undefined) params.set(URL_HASH_KEYS.GAIN, String(player.gain));
    if (player.audioUrl) params.set(URL_HASH_KEYS.AUDIO_URL, player.audioUrl);
    if (player.currentTime !== undefined) params.set(URL_HASH_KEYS.TIME, String(player.currentTime));
    if (analysis.vadPositiveThreshold !== undefined) params.set(URL_HASH_KEYS.VAD_POSITIVE, String(analysis.vadPositiveThreshold));
    if (analysis.vadNegativeThreshold !== undefined) params.set(URL_HASH_KEYS.VAD_NEGATIVE, String(analysis.vadNegativeThreshold));
    return params;
}

const updateUrlFromStateDebounced = debounce(() => {
    if (!hasInitializedFromUrl) return;

    // In a real scenario, you'd get current store values here
    // For now, we'll assume they are passed or accessible if this were part of a class/service
    // This function will be called by store subscribers that pass the latest state.
    // This is a simplified placeholder for the debounced function's body.
    // Actual state needs to be fetched from stores inside the debounced function or passed to it.

    // Placeholder: get current state from stores
    const currentPlayerState = get(playerStore) as PlayerState;
    const currentAnalysisState = get(analysisStore) as AnalysisState;

    const params = buildUrlSearchParams(currentPlayerState, currentAnalysisState);
    if (params.toString()) {
        goto(`?${params.toString()}`, { keepFocus: true, replaceState: true, noScroll: true });
    } else {
        // If no params, go to base path to clear URL
        const currentPath = get(page).url.pathname;
        goto(currentPath, { keepFocus: true, replaceState: true, noScroll: true });
    }
}, UI_CONSTANTS.DEBOUNCE_HASH_UPDATE_MS);


export function loadStateFromUrl() {
    const currentParams = get(page).url.searchParams;

    const speedStr = currentParams.get(URL_HASH_KEYS.SPEED);
    const pitchStr = currentParams.get(URL_HASH_KEYS.PITCH);
    const gainStr = currentParams.get(URL_HASH_KEYS.GAIN);
    const audioUrl = currentParams.get(URL_HASH_KEYS.AUDIO_URL);
    const timeStr = currentParams.get(URL_HASH_KEYS.TIME);
    const vadPositiveStr = currentParams.get(URL_HASH_KEYS.VAD_POSITIVE);
    const vadNegativeStr = currentParams.get(URL_HASH_KEYS.VAD_NEGATIVE);

    playerStore.update(s => ({
        ...s,
        speed: speedStr ? parseFloat(speedStr) : undefined, // Or default from constants/store
        pitch: pitchStr ? parseFloat(pitchStr) : undefined,
        gain: gainStr ? parseFloat(gainStr) : undefined,
        audioUrl: audioUrl || undefined,
        currentTime: timeStr ? parseFloat(timeStr) : undefined,
    }));

    analysisStore.update(s => ({
        ...s,
        vadPositiveThreshold: vadPositiveStr ? parseFloat(vadPositiveStr) : undefined,
        vadNegativeThreshold: vadNegativeStr ? parseFloat(vadNegativeStr) : undefined,
    }));

    // Important: Set flag after attempting to load and update stores
    // to allow subscriptions to start updating the URL.
    // Use a microtask to ensure stores have propagated changes before enabling URL updates.
    Promise.resolve().then(() => {
        hasInitializedFromUrl = true;
    });
}

export function subscribeToStoresForUrlUpdate(): () => void {
    // Ensure this is called after initial loadStateFromUrl
    if (!hasInitializedFromUrl) {
        console.warn("subscribeToStoresForUrlUpdate called before hasInitializedFromUrl is true. URL updates might be unexpected.");
    }

    const unsubPlayer = playerStore.subscribe(state => {
        if (hasInitializedFromUrl) { // Only update URL if initial load is done
            updateUrlFromStateDebounced(); // Debounced function will fetch latest store values
        }
    });

    const unsubAnalysis = analysisStore.subscribe(state => {
        if (hasInitializedFromUrl) {
            updateUrlFromStateDebounced();
        }
    });

    return () => {
        unsubPlayer();
        unsubAnalysis();
    };
}
