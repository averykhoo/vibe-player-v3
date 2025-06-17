// vibe-player-v2/src/lib/services/audioEngine.service.ts

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION: Imports
// ─────────────────────────────────────────────────────────────────────────────

import { get } from 'svelte/store';
import type {
	RubberbandInitPayload,
	RubberbandProcessPayload,
	RubberbandProcessResultPayload,
	WorkerErrorPayload,
	WorkerMessage
} from '$lib/types/worker.types';
import { RB_WORKER_MSG_TYPE } from '$lib/types/worker.types';
import { playerStore } from '$lib/stores/player.store';
import RubberbandWorker from '$lib/workers/rubberband.worker?worker&inline';
import { assert, AUDIO_ENGINE_CONSTANTS } from '$lib/utils';
import { analysisStore } from '../stores/analysis.store';

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION: Class Definition
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @class AudioEngineService
 * @description A singleton service that manages all Web Audio API interactions. It handles
 * audio decoding, playback scheduling, and communication with the Rubberband Web Worker
 * for time-stretching and pitch-shifting.
 */
class AudioEngineService {
	// ---------------------------------------------------------------------------
	//  SUB-SECTION: Singleton and Private Properties
	// ---------------------------------------------------------------------------

	private static instance: AudioEngineService;

	private worker: Worker | null = null;
	private audioContext: AudioContext | null = null;
	private gainNode: GainNode | null = null;
	private originalBuffer: AudioBuffer | null = null;

	private isPlaying = false;
	private isWorkerInitialized = false;
	private isStopping = false;

	private sourcePlaybackOffset = 0;
	private nextChunkTime = 0;

	/** The ID of the current requestAnimationFrame loop, used to cancel it. */
	private animationFrameId: number | null = null;

	private constructor() {}

	/**
	 * Gets the singleton instance of the AudioEngineService.
	 * @returns {AudioEngineService} The singleton instance.
	 */
	public static getInstance(): AudioEngineService {
		if (!AudioEngineService.instance) {
			AudioEngineService.instance = new AudioEngineService();
		}
		return AudioEngineService.instance;
	}

	// ---------------------------------------------------------------------------
	//  SUB-SECTION: Public API Methods (Defined as Arrow Functions)
	// ---------------------------------------------------------------------------

	/**
	 * Ensures the AudioContext is created. It must be called after a user
	 * interaction (e.g., a click) to comply with browser autoplay policies.
	 * @returns {Promise<void>}
	 */
	public unlockAudio = async (): Promise<void> => {
		const ctx = this._getAudioContext();
		if (ctx.state === 'suspended') {
			console.log('[AudioEngineService] AudioContext is suspended, attempting to resume...');
			await ctx.resume();
			console.log(`[AudioEngineService] AudioContext state is now: ${ctx.state}`);
		}
	};

	/**
	 * Loads an audio file from an ArrayBuffer, decodes it, and initializes the
	 * processing worker. This is the primary entry point for loading new audio.
	 * @param {ArrayBuffer} audioFileBuffer - The raw audio data.
	 * @param {string} fileName - The name of the file for logging and display.
	 * @returns {Promise<void>}
	 */
	public loadFile = async (audioFileBuffer: ArrayBuffer, fileName: string): Promise<void> => {
		console.log(`[AudioEngineService] loadFile called for: ${fileName}`);
		if (!audioFileBuffer || audioFileBuffer.byteLength === 0) {
			const errorMsg = 'loadFile received an invalid or empty ArrayBuffer.';
			console.error(`[AudioEngine] ${errorMsg}`);
			playerStore.update((s) => ({ ...s, error: errorMsg, isPlayable: false }));
			return;
		}

		await this.stop();

		const ctx = this._getAudioContext();
		playerStore.update((s) => ({
			...s,
			status: `Decoding ${fileName}...`,
			error: null,
			fileName,
			isPlayable: false
		}));

		try {
			console.log(`[AudioEngineService] Decoding audio data...`);
			this.originalBuffer = await ctx.decodeAudioData(audioFileBuffer);
			console.log(
				`[AudioEngineService] Audio decoded successfully. Duration: ${this.originalBuffer.duration.toFixed(2)}s, Channels: ${this.originalBuffer.numberOfChannels}, Sample Rate: ${this.originalBuffer.sampleRate}Hz`
			);

			if (!this.worker) {
				this.worker = new RubberbandWorker();
				this.worker.onmessage = this.handleWorkerMessage;
				this.worker.onerror = (err) => console.error('[AudioEngineService] Unhandled worker error:', err);
			} else {
				this.worker.postMessage({ type: RB_WORKER_MSG_TYPE.RESET });
			}
			this.isWorkerInitialized = false;

			const wasmResponse = await fetch(AUDIO_ENGINE_CONSTANTS.WASM_BINARY_URL);
			const loaderResponse = await fetch(AUDIO_ENGINE_CONSTANTS.LOADER_SCRIPT_URL);
			if (!wasmResponse.ok || !loaderResponse.ok) {
				throw new Error('Failed to fetch worker dependencies (WASM or loader script).');
			}
			const wasmBinary = await wasmResponse.arrayBuffer();
			const loaderScriptText = await loaderResponse.text();

			const initPayload: RubberbandInitPayload = {
				wasmBinary,
				loaderScriptText,
				origin: location.origin,
				sampleRate: this.originalBuffer.sampleRate,
				channels: this.originalBuffer.numberOfChannels,
				initialSpeed: get(playerStore).speed,
				initialPitch: get(playerStore).pitch
			};

			console.log(`[AudioEngineService] Posting INIT message to worker with payload:`, {
				...initPayload,
				wasmBinary: `[${wasmBinary.byteLength} bytes]`,
				loaderScriptText: `[${loaderScriptText.length} chars]`
			});
			this.worker.postMessage({ type: RB_WORKER_MSG_TYPE.INIT, payload: initPayload }, [
				wasmBinary
			]);

			playerStore.update((s) => ({
				...s,
				status: `Initializing processor for ${fileName}...`,
				duration: this.originalBuffer!.duration,
				audioBuffer: this.originalBuffer,
				sampleRate: this.originalBuffer!.sampleRate
			}));
			analysisStore.set({});
		} catch (e) {
			const error = e as Error;
			console.error(`[AudioEngineService] Error during loadFile: ${error.message}`);
			playerStore.update((s) => ({
				...s,
				status: `Error decoding`,
				error: error.message,
				isPlayable: false
			}));
			throw error;
		}
	};

	/**
	 * Starts or resumes playback.
	 */
	public play = async (): Promise<void> => {
		console.log(`[AudioEngineService] PLAY called. State: isPlaying=${this.isPlaying}, isWorkerInitialized=${this.isWorkerInitialized}`);
		if (this.isPlaying || !this.originalBuffer || !this.isWorkerInitialized) {
			console.warn('AudioEngine: Play command ignored. Not ready or already playing.');
			return;
		}

		if (this.animationFrameId) {
			cancelAnimationFrame(this.animationFrameId);
			this.animationFrameId = null;
		}

		const audioCtx = this._getAudioContext();
		if (audioCtx.state === 'suspended') await audioCtx.resume();

		this.isPlaying = true;
		playerStore.update((s) => ({ ...s, isPlaying: true, status: `Playing: ${s.fileName}` }));

		if (this.nextChunkTime === 0 || this.nextChunkTime < audioCtx.currentTime) {
			this.nextChunkTime = audioCtx.currentTime;
		}
		
		this._performSingleProcessAndPlayIteration();

		if (this.isPlaying) {
			this.animationFrameId = requestAnimationFrame(this._recursiveProcessAndPlayLoop);
		}
	};

	/**
	 * Pauses playback.
	 */
	public pause = (): void => {
		console.log(`[AudioEngineService] PAUSE called.`);
		if (!this.isPlaying) return;
		this.isPlaying = false;

		if (this.animationFrameId) {
			cancelAnimationFrame(this.animationFrameId);
			this.animationFrameId = null;
		}

		playerStore.update((s) => ({ ...s, isPlaying: false, status: `Paused: ${s.fileName || ''}` }));
	};

	/**
	 * Stops playback and resets position.
	 */
	public stop = async (): Promise<void> => {
		console.log(`[AudioEngineService] STOP called.`);
		this.isStopping = true;
		this.isPlaying = false;

		if (this.animationFrameId) {
			cancelAnimationFrame(this.animationFrameId);
			this.animationFrameId = null;
		}

		if (this.worker) this.worker.postMessage({ type: RB_WORKER_MSG_TYPE.RESET });
		
		this.sourcePlaybackOffset = 0;
		this.nextChunkTime = 0;
		playerStore.update((s) => ({
			...s,
			currentTime: 0,
			isPlaying: false,
			status: `Stopped: ${s.fileName || ''}`
		}));
		this.isStopping = false;
	};

	/**
	 * Seeks to a specific time in the audio.
	 */
	public seek = async (time: number): Promise<void> => {
		console.log(`[AudioEngineService] SEEK called. Target time: ${time.toFixed(2)}s`);
		if (!this.originalBuffer || time < 0 || time > this.originalBuffer.duration) {
			console.warn(`AudioEngine: Seek time ${time} is out of bounds.`);
			return;
		}

		const wasPlaying = this.isPlaying;
		this.pause();

		if (this.worker) this.worker.postMessage({ type: RB_WORKER_MSG_TYPE.RESET });

		this.sourcePlaybackOffset = time;
		this.nextChunkTime = this.audioContext ? this.audioContext.currentTime : 0;
		playerStore.update((s) => ({ ...s, currentTime: time }));

		if (wasPlaying) {
			setTimeout(() => {
				this.play();
			}, 50);
		}
	};

	/**
	 * Sets playback speed.
	 */
	public setSpeed = (speed: number): void => {
		console.log(`[AudioEngineService] setSpeed called with: ${speed}`);
		if (this.worker && this.isWorkerInitialized) {
			this.worker.postMessage({ type: RB_WORKER_MSG_TYPE.SET_SPEED, payload: { speed } });
		}
		playerStore.update((s) => ({ ...s, speed }));
	};

	/**
	 * Sets playback pitch.
	 */
	public setPitch = (pitch: number): void => {
		console.log(`[AudioEngineService] setPitch called with: ${pitch}`);
		if (this.worker && this.isWorkerInitialized) {
			this.worker.postMessage({ type: RB_WORKER_MSG_TYPE.SET_PITCH, payload: { pitch } });
		}
		playerStore.update((s) => ({ ...s, pitch }));
	};

	/**
	 * Sets master gain.
	 */
	public setGain = (level: number): void => {
		console.log(`[AudioEngineService] setGain called with: ${level}`);
		if (this.gainNode && this.audioContext) {
			const newGain = Math.max(0, Math.min(2, level));
			this.gainNode.gain.setValueAtTime(newGain, this.audioContext.currentTime);
			playerStore.update((s) => ({ ...s, gain: newGain }));
		}
	};

	/**
	 * Cleans up all resources.
	 */
	public dispose = (): void => {
		console.log('[AudioEngineService] Disposing all resources...');
		this.isPlaying = false;
		this.isStopping = true;
		if (this.animationFrameId) {
			cancelAnimationFrame(this.animationFrameId);
			this.animationFrameId = null;
		}

		this.worker?.terminate();
		this.worker = null;
		this.isWorkerInitialized = false;
		this.audioContext?.close();
		this.audioContext = null;
		console.log('[AudioEngineService] Dispose complete.');
	};
	
	// ---------------------------------------------------------------------------
	//  SUB-SECTION: Private Helper Methods
	// ---------------------------------------------------------------------------
	
	private _getAudioContext(): AudioContext {
		if (!this.audioContext || this.audioContext.state === 'closed') {
			this.audioContext = new AudioContext();
			this.gainNode = this.audioContext.createGain();
			this.gainNode.connect(this.audioContext.destination);
		}
		return this.audioContext;
	}
	
	private _recursiveProcessAndPlayLoop = (): void => {
		if (!this.isPlaying || !this.originalBuffer || this.isStopping || !this.audioContext) {
			this.animationFrameId = null;
			return;
		}
	
		playerStore.update((s) => ({ ...s, currentTime: this.sourcePlaybackOffset }));
		this._performSingleProcessAndPlayIteration();
	
		if (this.isPlaying) {
			this.animationFrameId = requestAnimationFrame(this._recursiveProcessAndPlayLoop);
		} else {
			this.animationFrameId = null;
		}
	};
	
	private _performSingleProcessAndPlayIteration = (): void => {
		assert(this.isPlaying, 'Processing loop ran while not playing.');
		assert(!this.isStopping, 'Processing loop ran while stopping.');
		assert(this.originalBuffer, 'Processing loop ran without an audio buffer.');
		assert(this.audioContext, 'Processing loop ran without an audio context.');
	
		if (!this.isPlaying || !this.originalBuffer || this.isStopping || !this.audioContext) return;
	
		const now = this.audioContext.currentTime;
		const lookahead = AUDIO_ENGINE_CONSTANTS.PROCESS_LOOKAHEAD_TIME;
	
		if (this.nextChunkTime < now + lookahead) {
			if (this.sourcePlaybackOffset < this.originalBuffer.duration) {
				const chunkDuration = AUDIO_ENGINE_CONSTANTS.TARGET_CHUNK_DURATION_S;
				let actualChunkDuration = Math.min(
					chunkDuration,
					this.originalBuffer.duration - this.sourcePlaybackOffset
				);
	
				if (actualChunkDuration <= AUDIO_ENGINE_CONSTANTS.MIN_CHUNK_DURATION_S) {
					actualChunkDuration = Math.min(
						this.originalBuffer.duration - this.sourcePlaybackOffset,
						AUDIO_ENGINE_CONSTANTS.TARGET_CHUNK_DURATION_S
					);
				}
	
				if (actualChunkDuration <= 0) {
					this.pause();
					playerStore.update((s) => ({ ...s, currentTime: this.originalBuffer!.duration }));
					return;
				}
	
				const startSample = Math.floor(this.sourcePlaybackOffset * this.originalBuffer.sampleRate);
				const endSample = Math.floor(
					Math.min(
						this.sourcePlaybackOffset + actualChunkDuration,
						this.originalBuffer.duration
					) * this.originalBuffer.sampleRate
				);
	
				if (startSample >= endSample) {
					this.pause();
					return;
				}
	
				const channelData = this.originalBuffer.getChannelData(0);
				const segment = channelData.slice(startSample, endSample);
				const isFinalChunk = this.sourcePlaybackOffset + actualChunkDuration >= this.originalBuffer.duration;
	
				console.log(`[AudioEngineService] Processing chunk. Offset: ${this.sourcePlaybackOffset.toFixed(2)}s, Duration: ${actualChunkDuration.toFixed(3)}s, Final: ${isFinalChunk}`);
	
				const processPayload: RubberbandProcessPayload = { inputBuffer: [segment], isFinalChunk };
				this.worker!.postMessage({ type: RB_WORKER_MSG_TYPE.PROCESS, payload: processPayload }, [segment.buffer]);
				this.sourcePlaybackOffset += actualChunkDuration;
			} else {
				this.pause();
				playerStore.update((s) => ({ ...s, currentTime: this.originalBuffer!.duration, status: `Finished: ${s.fileName}` }));
			}
		}
	};
	
	private scheduleChunkPlayback = (processedChannels: Float32Array[], startTime: number): void => {
		if (!processedChannels || processedChannels.length === 0 || processedChannels[0].length === 0) return;
	
		assert(this.audioContext, 'Attempted to schedule chunk without an audio context.');
		assert(this.gainNode, 'Attempted to schedule chunk without a gain node.');
		assert(this.originalBuffer, 'Attempted to schedule chunk without an original buffer.');
		assert(!this.isStopping, 'Attempted to schedule chunk while stopping.');
	
		if (!this.audioContext || !this.gainNode || this.isStopping || !this.originalBuffer) return;
	
		const numberOfChannels = this.originalBuffer.numberOfChannels;
		if (processedChannels.length !== numberOfChannels) {
			console.error(`ScheduleChunkPlayback: Mismatch in channel count. Expected ${numberOfChannels}, got ${processedChannels.length}.`);
			return;
		}
	
		const frameCount = processedChannels[0].length;
		if (frameCount === 0) return;
	
		const audioBuffer = this.audioContext.createBuffer(numberOfChannels, frameCount, this.originalBuffer.sampleRate);
		for (let i = 0; i < numberOfChannels; i++) {
			audioBuffer.copyToChannel(processedChannels[i], i);
		}
	
		const bufferSource = this.audioContext.createBufferSource();
		bufferSource.buffer = audioBuffer;
		bufferSource.connect(this.gainNode);
	
		const actualStartTime = Math.max(this.audioContext.currentTime, startTime);
		console.log(`[AudioEngineService] Scheduling chunk playback at ${actualStartTime.toFixed(2)}s. Duration: ${audioBuffer.duration.toFixed(3)}s.`);
		bufferSource.start(actualStartTime);
	
		const chunkDuration = audioBuffer.duration;
		this.nextChunkTime = actualStartTime + chunkDuration - AUDIO_ENGINE_CONSTANTS.SCHEDULE_AHEAD_TIME_S;
	
		bufferSource.onended = () => bufferSource.disconnect();
	};

	private handleWorkerMessage = (event: MessageEvent<WorkerMessage<RubberbandProcessResultPayload | WorkerErrorPayload>>): void => {
		const { type, payload } = event.data;
	
		switch (type) {
			case RB_WORKER_MSG_TYPE.INIT_SUCCESS:
				this.isWorkerInitialized = true;
				console.log('[AudioEngineService] Worker initialized successfully.');
				playerStore.update((s) => ({ ...s, isPlayable: true, status: `Ready: ${s.fileName}` }));
				break;
	
			case RB_WORKER_MSG_TYPE.ERROR:
				const errorPayload = payload as WorkerErrorPayload;
				console.error('[AudioEngineService] Worker Error:', errorPayload.message);
				playerStore.update((s) => ({
					...s,
					error: errorPayload.message,
					isPlaying: false,
					isPlayable: false,
					status: 'Error'
				}));
				this.isWorkerInitialized = false;
				if (this.isPlaying) this.pause();
				break;
	
			case RB_WORKER_MSG_TYPE.PROCESS_RESULT:
				const { outputBuffer } = payload as RubberbandProcessResultPayload;
				if (outputBuffer && this.isPlaying && !this.isStopping) {
					this.scheduleChunkPlayback(outputBuffer, this.nextChunkTime);
				}
				break;
	
			default:
				console.warn(`[AudioEngineService] Received unknown message type from worker: ${type}`);
		}
	};
}

export default AudioEngineService.getInstance();