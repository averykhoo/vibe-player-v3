// vibe-player-v2/src/lib/services/audioEngine.service.ts
import {get, writable} from "svelte/store";
import type {RubberbandInitPayload, RubberbandProcessResultPayload, WorkerMessage,} from "$lib/types/worker.types";
import {RB_WORKER_MSG_TYPE} from "$lib/types/worker.types";
import {AUDIO_ENGINE_CONSTANTS} from "$lib/utils"; // Assuming AUDIO_ENGINE_CONSTANTS is in utils/index
import {type PlayerState, playerStore} from "$lib/stores/player.store"; // Assuming playerStore exists

// Import worker using Vite's ?worker syntax
import RubberbandWorker from "$lib/workers/rubberband.worker?worker&inline";

interface AudioEngineState {
    isInitialized: boolean;
    isInitializing: boolean;
    error: string | null;
    audioContext: AudioContext | null;
    // Add other relevant state properties: gainNode, sourceNode, etc.
}

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
}

interface AudioEngineInitializeOptions {
    sampleRate: number;
    channels: number;
    initialSpeed: number;
    initialPitch: number;
    gain?: number;
}

const initialAudioEngineState: AudioEngineState = {
    isInitialized: false,
    isInitializing: false,
    error: null,
    audioContext: null,
};

// Internal store for the service's own state, not directly exposed but can update public stores.
const serviceState = writable<AudioEngineState>(initialAudioEngineState);

class AudioEngineService {
    private static instance: AudioEngineService;
    private worker: Worker | null = null;
    private audioContextInternal: AudioContext | null = null; // Renamed to avoid conflict with serviceState property
    private gainNode: GainNode | null = null;
    private originalAudioBuffer: AudioBuffer | null = null;
    private decodedAudioPlayerNode: AudioBufferSourceNode | null = null; // For playing original/decoded audio
    private isPlaying = writable(false); // Internal state for playback
    private nextMessageId = 0;
    private pendingRequests = new Map<string, PendingRequest>();

    private constructor() {
        // Initialize serviceState if needed, or rely on default
    }

    public static getInstance(): AudioEngineService {
        if (!AudioEngineService.instance) {
            AudioEngineService.instance = new AudioEngineService();
        }
        return AudioEngineService.instance;
    }

    private _getAudioContext(): AudioContext {
        if (!this.audioContextInternal) {
            this.audioContextInternal = new AudioContext();
            // Create main gain node
            this.gainNode = this.audioContextInternal.createGain();
            this.gainNode.connect(this.audioContextInternal.destination);
            console.log("AudioContext and GainNode created.");
        }
        return this.audioContextInternal;
    }

    public async unlockAudio(): Promise<void> {
        const ctx = this._getAudioContext();
        if (ctx.state === "suspended") {
            try {
                await ctx.resume();
                console.log("AudioContext resumed successfully.");
                playerStore.update((s: PlayerState) => ({...s, audioContextResumed: true}));
            } catch (e: unknown) {
                const errorMessage = e instanceof Error ? e.message : String(e);
                console.error("Error resuming AudioContext:", e);
                playerStore.update((s: PlayerState) => ({
                    ...s,
                    error: `Failed to resume audio context: ${errorMessage}`,
                }));
            }
        }
    }

    private generateMessageId(): string {
        return `rb_msg_${this.nextMessageId++}`;
    }

    private postMessageToWorker<T>(message: WorkerMessage<T>): Promise<unknown> {
        return new Promise((resolve, reject) => {
            if (!this.worker) {
                reject(new Error("Worker not initialized."));
                return;
            }
            const messageId = this.generateMessageId();
            this.pendingRequests.set(messageId, {resolve, reject});
            this.worker.postMessage({...message, messageId});
        });
    }

    public async initialize(options: AudioEngineInitializeOptions): Promise<void> {
        console.log('[AudioEngineService] Initialize called.');

        if (get(serviceState).isInitialized || get(serviceState).isInitializing) {
            console.warn("AudioEngineService already initialized or initializing.");
            return;
        }

        serviceState.update((s: AudioEngineState) => ({...s, isInitializing: true, error: null}));
        playerStore.update((s: PlayerState) => ({
            ...s,
            status: "Audio engine initializing...",
        }));

        this.worker = new RubberbandWorker();

        this.worker.onmessage = (event: MessageEvent<WorkerMessage<unknown>>) => {
            const {type, payload, error, messageId} = event.data;
            const request = messageId
                ? this.pendingRequests.get(messageId)
                : undefined;
            console.log(`[AudioEngineService] Received message from worker: type=${type}`);

            if (error) {
                const errorMsg = typeof error === 'string' ? error : (error as Error).message || 'Unknown worker error during message processing';
                console.error(`AudioEngineService Worker Error (type ${type}):`, errorMsg);
                serviceState.update((s: AudioEngineState) => ({...s, error: `Worker error: ${errorMsg}`}));
                if (request) {
                    request.reject(errorMsg);
                    if (messageId) this.pendingRequests.delete(messageId);
                }
                if (type === RB_WORKER_MSG_TYPE.INIT_ERROR) {
                    serviceState.update((s: AudioEngineState) => ({
                        ...s,
                        isInitialized: false,
                        isInitializing: false,
                    }));
                    playerStore.update((s: PlayerState) => ({
                        ...s,
                        status: "Error initializing audio engine.",
                        error: errorMsg,
                    }));
                }
                return;
            }

            switch (type) {
                case RB_WORKER_MSG_TYPE.INIT_SUCCESS:
                    console.log('[AudioEngineService] Worker reported INIT_SUCCESS.');

                    serviceState.update((s: AudioEngineState) => ({
                        ...s,
                        isInitialized: true,
                        isInitializing: false,
                    }));
                    playerStore.update((s: PlayerState) => ({
                        ...s,
                        status: "Audio engine initialized.",
                    }));
                    if (request) request.resolve(payload);
                    break;

                case RB_WORKER_MSG_TYPE.PROCESS_RESULT:
                    const resultPayload = payload as RubberbandProcessResultPayload;
                    console.log(
                        "Received processed audio chunk:",
                        resultPayload.outputBuffer,
                    );
                    playerStore.update((s: PlayerState) => ({
                        ...s,
                        lastProcessedChunk: resultPayload.outputBuffer,
                    }));
                    if (request) request.resolve(resultPayload);
                    break;

                case RB_WORKER_MSG_TYPE.FLUSH_RESULT:
                    console.log("Received flushed audio:", payload);
                    if (request) request.resolve(payload as RubberbandProcessResultPayload);
                    break;

                default:
                    console.log(
                        "AudioEngineService received message from worker:",
                        event.data,
                    );
                    if (request) request.resolve(payload); // Generic resolve for other messages
            }
            if (messageId && request) this.pendingRequests.delete(messageId);
        };

        this.worker.onerror = (err: Event | string) => {
            const errorMsg = typeof err === 'string' ? err : (err instanceof ErrorEvent ? err.message : 'Unknown worker error');
            console.error("Unhandled error in RubberbandWorker:", errorMsg);
            serviceState.update((s: AudioEngineState) => ({
                ...s,
                error: `Worker onerror: ${errorMsg}`,
                isInitialized: false,
                isInitializing: false,
            }));
            playerStore.update((s: PlayerState) => ({...s, status: "Critical worker error.", error: errorMsg}));
            // Reject all pending requests on a critical worker error
            this.pendingRequests.forEach((req) =>
                req.reject(new Error(`Worker failed critically: ${errorMsg}`)),
            );
            this.pendingRequests.clear();
        };

        const initPayload: RubberbandInitPayload = {
            wasmPath: AUDIO_ENGINE_CONSTANTS.WASM_BINARY_URL,
            loaderPath: AUDIO_ENGINE_CONSTANTS.LOADER_SCRIPT_URL,
            origin: location.origin,
            sampleRate: options.sampleRate,
            channels: options.channels,
            initialSpeed: options.initialSpeed,
            initialPitch: options.initialPitch,
        };

        try {
            console.log('[AudioEngineService] Posting INIT message to worker.');

            await this.postMessageToWorker<RubberbandInitPayload>({
                type: RB_WORKER_MSG_TYPE.INIT,
                payload: initPayload,
            });
            this._getAudioContext(); // Ensure AudioContext is created after worker init
            if (options.gain !== undefined) this.setGain(options.gain);
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            serviceState.update((s: AudioEngineState) => ({
                ...s,
                error: errorMessage || "Initialization failed",
                isInitialized: false,
                isInitializing: false,
            }));
            playerStore.update((s: PlayerState) => ({
                ...s,
                status: "Error sending init to worker.",
                error: errorMessage,
            }));
        }
    }

    public async loadFile(
        audioFileBuffer: ArrayBuffer,
        fileName: string,
    ): Promise<void> {
        if (!this.audioContextInternal) {
            this._getAudioContext();
            await this.unlockAudio();
        }
        if (!this.audioContextInternal) {
            playerStore.update((s: PlayerState) => ({
                ...s,
                error: "AudioContext not available for decoding.",
            }));
            throw new Error("AudioContext not available for decoding.");
        }

        playerStore.update((s: PlayerState) => ({
            ...s,
            status: `Decoding ${fileName}...`,
            error: null,
            fileName,
        }));
        try {
            this.originalAudioBuffer =
                await this.audioContextInternal.decodeAudioData(audioFileBuffer);

            let waveformDisplayData: number[][] = [];
            if (this.originalAudioBuffer) {
                const targetPoints = 1000;
                for (let i = 0; i < this.originalAudioBuffer.numberOfChannels; i++) {
                    const pcmData = this.originalAudioBuffer.getChannelData(i);
                    const channelWaveform: number[] = [];
                    const step = Math.max(1, Math.floor(pcmData.length / targetPoints));
                    for (let j = 0; j < pcmData.length; j += step) {
                        let blockMax = 0.0; // Changed from -1.0 to 0.0 as we use Math.abs
                        for (let k = 0; k < step && j + k < pcmData.length; k++) {
                            if (Math.abs(pcmData[j + k]) > blockMax) {
                                blockMax = Math.abs(pcmData[j + k]);
                            }
                        }
                        // To represent both positive and negative peaks, we could store min/max or just max abs value
                        // For simplicity, using the first sample's value, but max abs is better for waveform visualization
                        channelWaveform.push(pcmData[j]); // Or blockMax (needs adjustment if visualizer expects signed values)
                    }
                    waveformDisplayData.push(channelWaveform);
                }
            }

            playerStore.update((s: PlayerState) => ({
                ...s,
                status: `${fileName} decoded. Duration: ${this.originalAudioBuffer!.duration.toFixed(2)}s`,
                duration: this.originalAudioBuffer!.duration,
                channels: this.originalAudioBuffer!.numberOfChannels,
                sampleRate: this.originalAudioBuffer!.sampleRate,
                waveformData: waveformDisplayData,
                isPlayable: true,
                audioBuffer: this.originalAudioBuffer,
            }));
            console.log(
                "Decoded audio and extracted waveform data:",
                this.originalAudioBuffer,
            );

            console.warn(
                "AudioEngine not re-initialized with new file parameters automatically yet. Manual re-init might be needed if SR/channels change.",
            );
        } catch (e: unknown) {
            console.error("Error decoding audio data:", e);
            const errorMessage = e instanceof Error ? e.message : String(e);
            playerStore.update((s: PlayerState) => ({
                ...s,
                status: `Error decoding ${fileName}.`,
                error: errorMessage,
                isPlayable: false,
                waveformData: undefined,
            }));
            if (e instanceof Error) throw e; else throw new Error(String(e));
        }
    }

    public setGain(level: number): void {
        if (this.gainNode && this.audioContextInternal) {
            this.gainNode.gain.setValueAtTime(
                level,
                this.audioContextInternal.currentTime
            );
            playerStore.update((s: PlayerState) => ({...s, gain: level}));
        } else {
            console.warn("GainNode or AudioContext not available for setGain.");
        }
    }

    public play(): void {
        if (get(this.isPlaying)) {
            console.log("AudioEngine: Already playing.");
            return;
        }
        if (this.originalAudioBuffer && this.audioContextInternal && this.gainNode) {
            if (this.decodedAudioPlayerNode) {
                this.decodedAudioPlayerNode.stop();
                this.decodedAudioPlayerNode.disconnect();
            }

            this.decodedAudioPlayerNode =
                this.audioContextInternal.createBufferSource();
            this.decodedAudioPlayerNode.buffer = this.originalAudioBuffer;
            this.decodedAudioPlayerNode.connect(this.gainNode);

            if (this.decodedAudioPlayerNode) { // Check if node exists before setting onended
                this.decodedAudioPlayerNode.onended = () => {
                    this.isPlaying.set(false);
                    playerStore.update((s: PlayerState) => ({
                        ...s,
                        status: "Playback ended.",
                        isPlaying: false,
                    }));
                    this.decodedAudioPlayerNode = null;
                };
            }
            this.decodedAudioPlayerNode.start(0, get(playerStore).currentTime || 0);
            this.isPlaying.set(true);
            playerStore.update((s: PlayerState) => ({
                ...s,
                status: "Playing original audio...",
                isPlaying: true,
            }));
            console.log("AudioEngine: Play called. Playing original buffer.");
        } else {
            playerStore.update((s: PlayerState) => ({
                ...s,
                status: "No audio loaded or engine not ready.",
                error: "Cannot play: No audio loaded or engine not ready."
            }));
            console.log("AudioEngine: Play called, but prerequisites not met.");
        }
    }

    public pause(): void {
        if (!get(this.isPlaying)) {
            console.log("AudioEngine: Not playing.");
            return;
        }
        if (this.decodedAudioPlayerNode && this.audioContextInternal) {
            const nodeAsAny = this.decodedAudioPlayerNode as any;
            let calculatedTime = 0;
            if (typeof nodeAsAny._startTime === 'number') {
                calculatedTime = this.audioContextInternal.currentTime - nodeAsAny._startTime;
            } else {
                console.warn("Could not determine node's start time for accurate pause position.");
                calculatedTime = get(playerStore).currentTime || 0;
            }

            playerStore.update((s: PlayerState) => ({
                ...s,
                currentTime: calculatedTime >= 0 ? calculatedTime : 0,
            }));
            this.decodedAudioPlayerNode.stop();
            this.isPlaying.set(false);
            playerStore.update((s: PlayerState) => ({
                ...s,
                status: "Playback paused.",
                isPlaying: false,
            }));
            console.log("AudioEngine: Pause called.");
        } else {
            console.log("AudioEngine: Pause called, but no active player node or audio context.");
        }
    }

    public stop(): void {
        if (this.decodedAudioPlayerNode) {
            this.decodedAudioPlayerNode.stop();
            this.decodedAudioPlayerNode.disconnect();
            this.decodedAudioPlayerNode = null;
        }
        this.isPlaying.set(false);
        playerStore.update((s: PlayerState) => ({
            ...s,
            status: "Playback stopped.",
            isPlaying: false,
            currentTime: 0,
        }));
        console.log("AudioEngine: Stop called.");
    }

    public async setSpeed(speed: number): Promise<void> {
        if (!this.worker) {
            throw new Error("Worker not initialized.");
        }
        if (!get(serviceState).isInitialized) throw new Error("Service not initialized.");
        await this.postMessageToWorker<object>({ // Assuming payload is an object like { speed }
            type: RB_WORKER_MSG_TYPE.SET_SPEED,
            payload: {speed},
        });
        playerStore.update((s: PlayerState) => ({...s, speed}));
    }

    public async setPitch(pitch: number): Promise<void> {
        if (!this.worker) {
            throw new Error("Worker not initialized.");
        }
        if (!get(serviceState).isInitialized) throw new Error("Service not initialized.");
        await this.postMessageToWorker<object>({ // Assuming payload is an object like { pitch }
            type: RB_WORKER_MSG_TYPE.SET_PITCH,
            payload: {pitch},
        });
        playerStore.update((s: PlayerState) => ({...s, pitch}));
    }

    public async processAudioChunk(
        inputBuffer: Float32Array[],
    ): Promise<RubberbandProcessResultPayload | null> {
        if (!this.worker) {
            throw new Error("Worker not initialized.");
        }
        if (!get(serviceState).isInitialized) throw new Error("Service not initialized.");
        try {
            const result = await this.postMessageToWorker<{ inputBuffer: Float32Array[] }>({
                type: RB_WORKER_MSG_TYPE.PROCESS,
                payload: {inputBuffer},
            });
            return result as RubberbandProcessResultPayload;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error("Error processing audio chunk:", errorMessage);
            playerStore.update((s: PlayerState) => ({...s, error: `Error processing audio: ${errorMessage}`}));
            return null;
        }
    }

    public async flush(): Promise<RubberbandProcessResultPayload | null> {
        if (!this.worker) {
            throw new Error("Worker not initialized.");
        }
        if (!get(serviceState).isInitialized) throw new Error("Service not initialized.");
        try {
            const result = await this.postMessageToWorker<undefined>({ // No payload for flush typically
                type: RB_WORKER_MSG_TYPE.FLUSH,
            });
            return result as RubberbandProcessResultPayload;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error("Error flushing audio:", errorMessage);
            playerStore.update((s: PlayerState) => ({...s, error: `Error flushing audio: ${errorMessage}`}));
            return null;
        }
    }

    public playAudioBuffer(buffer: Float32Array[], sampleRate: number): void {
        const ctx = this._getAudioContext();
        if (!this.gainNode) {
            console.error("GainNode not initialized!");
            playerStore.update((s: PlayerState) => ({...s, error: "Cannot play buffer: GainNode missing."}));
            return;
        }

        const audioBuffer = ctx.createBuffer(
            buffer.length, // Number of channels
            buffer[0].length, // Length of each channel array (number of frames)
            sampleRate,
        );
        for (let i = 0; i < buffer.length; i++) {
            audioBuffer.copyToChannel(buffer[i], i);
        }

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.gainNode);
        source.start();
    }

    public dispose(): void {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        if (this.audioContextInternal) {
            this.audioContextInternal.close().then(() => {
                this.audioContextInternal = null;
                this.gainNode = null;
            }).catch(e => console.error("Error closing AudioContext: ", e));
        }
        this.pendingRequests.clear();
        this.nextMessageId = 0;
        serviceState.set(initialAudioEngineState);
        playerStore.update((s: PlayerState) => ({
            ...s,
            status: "Audio engine disposed.",
            isPlayable: false, // Should not be playable after dispose
            isPlaying: false,
            // Reset other relevant player states
            fileName: null,
            duration: 0,
            currentTime: 0,
            audioBuffer: undefined,
            waveformData: undefined,
            error: null,
        }));
        console.log("AudioEngineService disposed.");
    }
}

export default AudioEngineService.getInstance();
