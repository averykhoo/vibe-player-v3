// vibe-player-v2/src/lib/services/audioEngine.service.test.ts
import { writable, type Writable } from 'svelte/store';
import { vi } from 'vitest';

// --- Mocks ---
// All vi.mock calls are hoisted to the top. They must come before other imports.

// Mock the Svelte store with a real writable instance created inside the factory.
// This solves the "Cannot access before initialization" ReferenceError.
vi.mock('$lib/stores/player.store', async () => {
	const { writable: actualWritable } = await vi.importActual<typeof import('svelte/store')>(
		'svelte/store'
	);
	const initialPlayerState = {
		speed: 1.0,
		pitch: 0.0,
		gain: 1.0,
		isPlayable: false,
		isPlaying: false,
		error: null,
		fileName: '',
		status: '',
		duration: 0,
		currentTime: 0,
		audioBuffer: null
	};
	const internalPlayerStoreInstance = actualWritable({ ...initialPlayerState });

	return {
		playerStore: internalPlayerStoreInstance,
		// Provide an "accessor" function so our tests can get a handle to the mock instance.
		__test__getPlayerStoreInstance: () => internalPlayerStoreInstance,
		__test__getInitialPlayerState: () => ({ ...initialPlayerState })
	};
});

// Mock the web worker dependency.
const mockWorkerInstance = {
	postMessage: vi.fn(),
	terminate: vi.fn(),
	onmessage: null as ((event: MessageEvent) => void) | null,
	onerror: null as ((event: ErrorEvent) => void) | null
};
vi.mock('$lib/workers/rubberband.worker?worker&inline', () => ({
	default: vi.fn().mockImplementation(() => mockWorkerInstance)
}));

// Mock AudioContext and its methods.
const mockDecodeAudioData = vi.fn();
global.AudioContext = vi.fn(() => ({
	decodeAudioData: mockDecodeAudioData,
	createGain: vi.fn(() => ({
		connect: vi.fn(),
		gain: { setValueAtTime: vi.fn() }
	})),
	resume: vi.fn().mockResolvedValue(undefined),
	close: vi.fn().mockResolvedValue(undefined),
	state: 'running',
	currentTime: 0,
	destination: {},
	sampleRate: 48000
})) as any;

// Mock fetch for worker dependencies.
vi.spyOn(global, 'fetch').mockImplementation(() =>
	Promise.resolve({
		ok: true,
		status: 200,
		arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
		text: () => Promise.resolve('// Mock loader script')
	} as Response)
);
// --- End Mocks ---

// Now, we can safely import everything else.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import audioEngineService from './audioEngine.service'; // We import the REAL service.
import { RB_WORKER_MSG_TYPE } from '$lib/types/worker.types';
import {
	__test__getPlayerStoreInstance,
	__test__getInitialPlayerState
} from '$lib/stores/player.store'; // Import the test accessors.

describe('AudioEngineService (Corrected Tests)', () => {
	const MOCK_RAF_ID = 12345;
	let rafSpy: ReturnType<typeof vi.spyOn>;
	let cafSpy: ReturnType<typeof vi.spyOn>;
	let mockAudioBuffer: AudioBuffer;
	let playerStoreInstance: Writable<any>;

	// Helper to simulate the worker becoming ready after INIT.
	const makeWorkerReady = () => {
		mockWorkerInstance.onmessage!({
			data: { type: RB_WORKER_MSG_TYPE.INIT_SUCCESS }
		} as MessageEvent);
	};

	beforeEach(async () => {
		// Reset mocks and state before each test.
		vi.clearAllMocks();

		// Get the handle to our mocked store instance and reset it.
		playerStoreInstance = __test__getPlayerStoreInstance();
		playerStoreInstance.set({ ...__test__getInitialPlayerState() });

		// Dispose the service to ensure a clean state from the previous test.
		audioEngineService.dispose();

		// Spy on animation frame methods.
		rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(MOCK_RAF_ID);
		cafSpy = vi.spyOn(window, 'cancelAnimationFrame');

		// Create a mock AudioBuffer for tests.
		mockAudioBuffer = {
			duration: 10.0,
			numberOfChannels: 1,
			sampleRate: 44100,
			getChannelData: vi.fn(() => new Float32Array(441000).fill(0.1)),
			length: 441000
		} as unknown as AudioBuffer;
		mockDecodeAudioData.mockResolvedValue(mockAudioBuffer);

		// Initialize the service for each test, as most tests require it.
		await audioEngineService.loadFile(new ArrayBuffer(8), 'test.wav');
		makeWorkerReady();
	});

	afterEach(() => {
		rafSpy.mockRestore();
		cafSpy.mockRestore();
	});

	describe('loadFile', () => {
		it('should post an INIT message to the worker with correct audio parameters', () => {
			expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: RB_WORKER_MSG_TYPE.INIT,
					payload: expect.objectContaining({
						channels: mockAudioBuffer.numberOfChannels,
						sampleRate: mockAudioBuffer.sampleRate
					})
				}),
				expect.any(Array)
			);
		});

		it('should update the player store to be playable after worker is initialized', () => {
			expect(get(playerStoreInstance).isPlayable).toBe(true);
			expect(get(playerStoreInstance).status).toContain('Ready');
		});
	});

	describe('play', () => {
		it('should start the animation loop by calling requestAnimationFrame', async () => {
			await audioEngineService.play();
			expect(rafSpy).toHaveBeenCalledTimes(1);
		});

		it('should not play if worker is not initialized', async () => {
			audioEngineService.dispose(); // Reset service, worker is not initialized.
			await audioEngineService.play();
			expect(rafSpy).not.toHaveBeenCalled();
		});
	});

	describe('pause', () => {
		it('should stop the animation loop by calling cancelAnimationFrame', async () => {
			await audioEngineService.play();
			expect(rafSpy).toHaveBeenCalledTimes(1); // Loop started.

			audioEngineService.pause();
			expect(cafSpy).toHaveBeenCalledWith(MOCK_RAF_ID); // Loop canceled.
			expect(get(playerStoreInstance).isPlaying).toBe(false);
		});
	});

	describe('stop', () => {
		it('should cancel the animation loop, reset worker, and reset time', async () => {
			await audioEngineService.play(); // Start playing.
			playerStoreInstance.update((s) => ({ ...s, currentTime: 5.0 })); // Simulate time advance.

			await audioEngineService.stop();

			expect(cafSpy).toHaveBeenCalledWith(MOCK_RAF_ID);
			expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith({
				type: RB_WORKER_MSG_TYPE.RESET
			});
			expect(get(playerStoreInstance).isPlaying).toBe(false);
			expect(get(playerStoreInstance).currentTime).toBe(0);
		});
	});

	describe('seek', () => {
		it('should update time and reset worker when seeking while paused', async () => {
			// Arrange: Ensure player is paused
			expect(get(playerStoreInstance).isPlaying).toBe(false);

			// Act
			await audioEngineService.seek(5.0);

			// Assert
			expect(rafSpy).not.toHaveBeenCalled(); // Should NOT have started playback
			expect(cafSpy).not.toHaveBeenCalled(); // Nothing to cancel
			expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith({
				type: RB_WORKER_MSG_TYPE.RESET
			});
			expect(get(playerStoreInstance).currentTime).toBe(5.0);
			expect(get(playerStoreInstance).isPlaying).toBe(false); // Should remain paused.
		});

		it('should pause playback, update time, and reset worker when seeking while playing', async () => {
			// Arrange: Start playback
			await audioEngineService.play();
			expect(rafSpy).toHaveBeenCalledTimes(1);
			vi.clearAllMocks(); // Clear spies to isolate the seek action

			// Act
			await audioEngineService.seek(3.0);

			// Assert
			// 1. The old animation frame was canceled because `pause()` is called inside `seek()`.
			expect(cafSpy).toHaveBeenCalledWith(MOCK_RAF_ID);

			// 2. The worker was told to reset its state for the new position.
			expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith({
				type: RB_WORKER_MSG_TYPE.RESET
			});

			// 3. The store's time was updated correctly.
			expect(get(playerStoreInstance).currentTime).toBe(3.0);

			// 4. A *new* animation frame was NOT requested because seek no longer resumes.
			expect(rafSpy).not.toHaveBeenCalled();

			// 5. The store reflects that playback is now paused.
			expect(get(playerStoreInstance).isPlaying).toBe(false);
		});
	});
});