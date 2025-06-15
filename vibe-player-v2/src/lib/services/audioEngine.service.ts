// vibe-player-v2/src/lib/services/audioEngine.service.ts

import { get, writable } from 'svelte/store';
import type { WorkerMessage, RubberbandInitPayload, RubberbandProcessPayload, RubberbandProcessResultPayload } from '$lib/types/worker.types';
import { RB_WORKER_MSG_TYPE } from '$lib/types/worker.types';
import { playerStore } from '$lib/stores/player.store';
import RubberbandWorker from '$lib/workers/rubberband.worker?worker&inline';
import { AUDIO_ENGINE_CONSTANTS } from '$lib/utils';
import { analysisStore } from '../stores/analysis.store';

/**
 * Manages the audio playback pipeline, including processing via the Rubberband worker.
 * This service implements a buffered playback strategy suitable for a standard Web Worker.
 *
 * How it works:
 * 1. `play()`: Kicks off the `processAndPlayLoop`.
 * 2. `processAndPlayLoop()`: Takes a chunk of the original audio, sends it to the worker for processing.
 * 3. `handleWorkerMessage()`: Receives the processed chunk from the worker.
 * 4. `scheduleChunkPlayback()`: Takes the processed chunk, puts it in an AudioBuffer, and schedules it to play
 *    at a precise time in the future (`nextChunkTime`).
 * 5. The loop continues, ensuring there's always a buffer of processed audio ready to play, creating seamless playback.
 */
class AudioEngineService {
    private static instance: AudioEngineService;
    private worker: Worker | null = null;

    // Web Audio API State
    private audioContext: AudioContext | null = null;
    private gainNode: GainNode | null = null;
    private originalBuffer: AudioBuffer | null = null;

    // Playback State Machine
    private isPlaying = false;
    private isWorkerInitialized = false;
    private isStopping = false; // Flag to gracefully stop the processing loop
    private sourcePlaybackOffset = 0; // Tracks our position in the *original* audio buffer (in samples)
    private nextChunkTime = 0; // The AudioContext time at which the next processed chunk should start playing

    private constructor() {
        // **CRITICAL CHANGE**: The constructor is now EMPTY.
        // It no longer creates a worker, making it safe to run on the server.
    }

    public static getInstance(): AudioEngineService {
        if (!AudioEngineService.instance) {
            AudioEngineService.instance = new AudioEngineService();
        }
        return AudioEngineService.instance;
    }

    /**
     * Initializes the service for client-side execution.
     * This method MUST be called from onMount in a Svelte component.
     */
    public initialize(): void {
        // If already initialized (e.g., due to fast-refresh in dev), do nothing.
        if (this.worker) return;

        console.log("AudioEngineService: Initializing for client...");
        this.worker = new RubberbandWorker();
        this.worker.onmessage = this.handleWorkerMessage.bind(this);
    }

    private _getAudioContext(): AudioContext {
        if (!this.audioContext || this.audioContext.state === 'closed') {
            this.audioContext = new AudioContext();
            this.gainNode = this.audioContext.createGain();
            this.gainNode.connect(this.audioContext.destination);
        }
        return this.audioContext;
    }

    public async unlockAudio(): Promise<void> {
        const ctx = this._getAudioContext();
        if (ctx.state === 'suspended') {
            await ctx.resume();
            console.log("AudioContext resumed successfully.");
        }
    }

    public async loadFile(audioFileBuffer: ArrayBuffer, fileName: string): Promise<void> {
        await this.stop(); // Stop and reset any current playback
        const ctx = this._getAudioContext();

        playerStore.update(s => ({ ...s, status: `Decoding ${fileName}...`, error: null, fileName, isPlayable: false }));

        try {
            this.originalBuffer = await ctx.decodeAudioData(audioFileBuffer);

            // --- START of CHANGE ---
            // REMOVED: Worker initialization is now handled eagerly at application startup.
            // We no longer need to fetch dependencies or send the INIT message here.
            // --- END of CHANGE ---

            // **FIX**: Extract waveform data for the UI here
            const waveformDisplayData: number[][] = [];
            const targetPoints = 1000;
            for (let i = 0; i < this.originalBuffer.numberOfChannels; i++) {
                const pcmData = this.originalBuffer.getChannelData(i);
                const channelWaveform: number[] = [];
                const step = Math.max(1, Math.floor(pcmData.length / targetPoints));
                for (let j = 0; j < pcmData.length; j += step) {
                    channelWaveform.push(pcmData[j]);
                }
                waveformDisplayData.push(channelWaveform);
            }

            playerStore.update(s => ({
                ...s,
                status: `Ready: ${fileName}`,
                duration: this.originalBuffer!.duration,
                isPlayable: true,
                audioBuffer: this.originalBuffer,
                waveformData: waveformDisplayData, // Add waveform data to the store
            }));
            analysisStore.set({}); // Reset analysis store for the new file

        } catch (e) {
            const error = e as Error;
            playerStore.update(s => ({ ...s, status: `Error decoding`, error: error.message, isPlayable: false }));
            throw error;
        }
    }

    public async play(): Promise<void> {
        if (this.isPlaying || !this.originalBuffer || !this.isWorkerInitialized) return;

        await this.unlockAudio();
        const ctx = this._getAudioContext();

        this.isPlaying = true;
        this.isStopping = false;
        playerStore.update(s => ({ ...s, isPlaying: true }));

        this.nextChunkTime = ctx.currentTime + 0.1; // Start playback with a small latency buffer
        this.processAndPlayLoop(); // Start the processing pipeline
    }

    public pause(): void {
        if (!this.isPlaying) return;
        this.isPlaying = false;
        this.isStopping = true;
        playerStore.update(s => ({ ...s, isPlaying: false }));
    }

    public async stop(): Promise<void> {
        this.pause();
        this.sourcePlaybackOffset = 0;
        this.worker?.postMessage({ type: RB_WORKER_MSG_TYPE.RESET }); // Reset worker state
        playerStore.update(s => ({ ...s, currentTime: 0 }));
    }

    public async seek(time: number): Promise<void> {
        const wasPlaying = this.isPlaying;
        if (wasPlaying) {
            this.pause();
        }

        // Wait a moment for any in-flight processing to stop
        await new Promise(resolve => setTimeout(resolve, 50));

        this.sourcePlaybackOffset = this.originalBuffer ? Math.max(0, time) * this.originalBuffer.sampleRate : 0;
        this.worker?.postMessage({ type: RB_WORKER_MSG_TYPE.RESET });
        playerStore.update(s => ({ ...s, currentTime: time }));

        if (wasPlaying) {
            await this.play();
        }
    }

    public setSpeed(speed: number): void {
        playerStore.update(s => ({ ...s, speed }));
        this.worker?.postMessage({ type: RB_WORKER_MSG_TYPE.SET_SPEED, payload: { speed } });
    }

    public setPitch(pitch: number): void {
        playerStore.update(s => ({ ...s, pitch }));
        this.worker?.postMessage({ type: RB_WORKER_MSG_TYPE.SET_PITCH, payload: { pitch } });
    }

    public setGain(level: number): void {
        if (this.gainNode) {
            this.gainNode.gain.setValueAtTime(level, this._getAudioContext().currentTime);
        }
        playerStore.update(s => ({ ...s, gain: level }));
    }

    public dispose(): void {
        this.stop();
        this.worker?.terminate();
        this.worker = null;
        this.audioContext?.close();
        this.audioContext = null;
    }

    private processAndPlayLoop(): void {
        if (!this.originalBuffer || !this.worker || this.isStopping || !this.isPlaying) {
            if (this.isStopping) this.isStopping = false; // Reset flag after stopping
            return;
        }

        const CHUNK_SIZE = 8192; // Process 8192 samples at a time

        if (this.sourcePlaybackOffset >= this.originalBuffer.length) {
            this.stop(); // End of buffer reached
            return;
        }

        const chunkEnd = Math.min(this.sourcePlaybackOffset + CHUNK_SIZE, this.originalBuffer.length);
        const inputSlices: Float32Array[] = [];
        const transferable: ArrayBuffer[] = [];

        for (let i = 0; i < this.originalBuffer.numberOfChannels; i++) {
            const slice = this.originalBuffer.getChannelData(i).subarray(this.sourcePlaybackOffset, chunkEnd);
            inputSlices.push(slice);
            transferable.push(slice.buffer);
        }

        const payload: RubberbandProcessPayload = { inputBuffer: inputSlices };
        this.worker.postMessage({ type: RB_WORKER_MSG_TYPE.PROCESS, payload }, transferable);

        this.sourcePlaybackOffset = chunkEnd;
        playerStore.update(s => ({ ...s, currentTime: this.sourcePlaybackOffset / this.originalBuffer!.sampleRate }));
    }

    private handleWorkerMessage(event: MessageEvent<WorkerMessage<RubberbandProcessResultPayload>>): void {
        const { type, payload } = event.data;

        if (type === RB_WORKER_MSG_TYPE.INIT_SUCCESS) {
            this.isWorkerInitialized = true;
            console.log("AudioEngine worker initialized.");
            if (get(playerStore).audioBuffer) {
                playerStore.update(s => ({...s, isPlayable: true}));
            }
        } else if (type === RB_WORKER_MSG_TYPE.PROCESS_RESULT && payload?.outputBuffer) {
            this.scheduleChunkPlayback(payload.outputBuffer);
            // The loop continues by calling processAndPlayLoop again from here
            if (this.isPlaying) {
                this.processAndPlayLoop();
            }
        }
    }

    private scheduleChunkPlayback(processedChannels: Float32Array[]): void {
        if (processedChannels.length === 0 || processedChannels[0].length === 0) return;

        const ctx = this._getAudioContext();
        if (ctx.state === 'closed') return;

        const frameCount = processedChannels[0].length;
        const processedBuffer = ctx.createBuffer(
            processedChannels.length,
            frameCount,
            this.originalBuffer!.sampleRate
        );

        for (let i = 0; i < processedChannels.length; i++) {
            processedBuffer.copyToChannel(processedChannels[i], i);
        }

        const sourceNode = ctx.createBufferSource();
        sourceNode.buffer = processedBuffer;
        sourceNode.connect(this.gainNode!);
        sourceNode.start(this.nextChunkTime);

        this.nextChunkTime += processedBuffer.duration;
    }
}

export default AudioEngineService.getInstance();
