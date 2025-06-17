// vibe-player-v2/src/lib/stores/player.store.ts
import { writable } from 'svelte/store';
import type { PlayerState } from '$lib/types/player.types';
import { updateUrlWithParams } from '../utils/urlState';
import { debounce } from '../utils/async';

const initialState: PlayerState = {
	status: 'idle',
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
	lastProcessedChunk: undefined
};

export const playerStore = writable<PlayerState>(initialState);

// --- State Serialization to URL ---
// Keep track of previous values to see what changed.
let previousSpeed: number | undefined = initialState.speed;
let previousPitch: number | undefined = initialState.pitch;
let previousGain: number | undefined = initialState.gain;

/**
 * Creates a debounced function that serializes the current player state to the URL.
 */
const debouncedUpdateUrl = debounce((params: Record<string, string>) => {
	updateUrlWithParams(params);
}, 300);

/**
 * Subscribes to the playerStore to automatically update the URL when relevant
 * parameters (like speed, pitch, gain) change from their default values.
 */
playerStore.subscribe((currentState) => {
	// LOG: Log the entire current state object whenever the store updates.
	console.log('[player.store.ts] Store changed. New state:', currentState);

	const params: Record<string, string> = {};
	let changed = false;

	if (currentState.speed !== previousSpeed) {
		if (currentState.speed !== undefined && currentState.speed !== initialState.speed) {
			params.speed = currentState.speed.toFixed(2);
		}
		previousSpeed = currentState.speed;
		changed = true;
	}

	if (currentState.pitch !== previousPitch) {
		if (currentState.pitch !== undefined && currentState.pitch !== initialState.pitch) {
			params.pitch = currentState.pitch.toFixed(2);
		}
		previousPitch = currentState.pitch;
		changed = true;
	}

	if (currentState.gain !== previousGain) {
		if (currentState.gain !== undefined && currentState.gain !== initialState.gain) {
			params.gain = currentState.gain.toFixed(2);
		}
		previousGain = currentState.gain;
		changed = true;
	}

	if (changed) {
		// LOG: Show what parameters are about to be sent to the debounced URL updater.
		console.log('[player.store.ts] A parameter changed. Queuing URL update with params:', params);
		debouncedUpdateUrl(params);
	}
});