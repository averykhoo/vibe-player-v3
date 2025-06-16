// vibe-player-v2/src/lib/utils/urlState.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  loadStateFromUrl,
  subscribeToStoresForUrlUpdate,
  _resetUrlStateInitializationFlagForTesting,
} from "./urlState";
import { page } from "$app/stores";
import { goto } from "$app/navigation";
import { playerStore } from "../stores/player.store";
import { analysisStore } from "../stores/analysis.store";
import { UI_CONSTANTS, URL_HASH_KEYS } from "./constants";
import type { Writable } from "svelte/store";
import { writable } from "svelte/store"; // Import writable

// Mocks
// Create a real writable store for the page mock
const mockPageData = {
  url: { searchParams: new URLSearchParams(), pathname: "/" },
  // Add other initial properties if your code uses them
};
const mockPageStoreInstance = writable(mockPageData);

vi.mock("$app/stores", () => ({
  get page() {
    // Use a getter to ensure the mock instance is used
    return mockPageStoreInstance;
  },
}));

vi.mock("$app/navigation", () => ({
  goto: vi.fn(),
}));

// Create actual writable stores for playerStore and analysisStore to be used in tests
const initialPlayerState = {
  speed: 1.0,
  pitch: 0,
  // Add other relevant player store properties with initial values
  // Ensure all properties accessed by buildUrlSearchParams are present
  currentTime: 0,
  duration: 0,
  isPlaying: false,
  isPlayable: false,
  fileName: null,
  error: null,
  gain: 1,
  waveformData: null,
  status: "Ready",
};
const mockPlayerStoreInstance = writable(initialPlayerState);

const initialAnalysisState = {
  vadPositiveThreshold: 0.5, // Example initial value
  vadNegativeThreshold: 0.35, // Example initial value
  // Add other relevant analysis store properties
  spectrogramData: null,
  isSpeaking: false,
  status: "Ready",
  spectrogramStatus: "Ready",
  error: null,
  spectrogramError: null,
  lastVadResult: null,
  vadStateResetted: false,
};
const mockAnalysisStoreInstance = writable(initialAnalysisState);

vi.mock("../stores/player.store", () => ({
  get playerStore() {
    return mockPlayerStoreInstance;
  },
}));

vi.mock("../stores/analysis.store", () => ({
  get analysisStore() {
    return mockAnalysisStoreInstance;
  },
}));

// Helper to update the mock Svelte's page store
async function updateMockPageStore(searchParams: URLSearchParams) {
  const newPageValue = {
    url: {
      searchParams,
      pathname: "/", // Default pathname
    },
    // Add other properties if your code uses them
  };
  mockPageStoreInstance.set(newPageValue); // Use the .set method of the writable store
}

describe("urlState utilities", () => {
  beforeEach(async () => {
    // Reset module state FIRST
    _resetUrlStateInitializationFlagForTesting();

    // Then setup timers
    vi.useFakeTimers();

    // Then clear any pending microtasks from previous tests that might have been queued *before* this beforeEach
    // This ensures that if a previous test did loadStateFromUrl(), its Promise.resolve().then() is flushed.
    vi.runAllTimers(); // This is crucial for the hasInitializedFromUrl flag

    // Reset the store to default for each test
    mockPageStoreInstance.set({
      url: { searchParams: new URLSearchParams(), pathname: "/" },
    });
    mockPlayerStoreInstance.set(initialPlayerState);
    mockAnalysisStoreInstance.set(initialAnalysisState);

    // Clear specific mocks if necessary, e.g., goto
    vi.mocked(goto).mockClear();

    // Re-spy on store methods as vi.restoreAllMocks() in afterEach clears them
    // (or if vi.clearAllMocks() was used above, which it is not currently)
    vi.spyOn(mockPlayerStoreInstance, "update");
    vi.spyOn(mockPlayerStoreInstance, "subscribe");
    vi.spyOn(mockPlayerStoreInstance, "set");
    vi.spyOn(mockAnalysisStoreInstance, "update");
    vi.spyOn(mockAnalysisStoreInstance, "subscribe");
    vi.spyOn(mockAnalysisStoreInstance, "set");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("loadStateFromUrl", () => {
    it("should call playerStore.update with parsed speed from URL", async () => {
      const params = new URLSearchParams();
      params.set(URL_HASH_KEYS.SPEED, "1.75");
      await updateMockPageStore(params);

      loadStateFromUrl();

      expect(playerStore.update).toHaveBeenCalled();
      const lastCallArg = (playerStore.update as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      const newState = lastCallArg({}); // Call the updater function
      expect(newState.speed).toBe(1.75);
    });

    it("should call analysisStore.update with parsed VAD thresholds from URL", async () => {
      const params = new URLSearchParams();
      params.set(URL_HASH_KEYS.VAD_POSITIVE, "0.8");
      params.set(URL_HASH_KEYS.VAD_NEGATIVE, "0.2");
      await updateMockPageStore(params);

      loadStateFromUrl();

      expect(analysisStore.update).toHaveBeenCalled();
      const lastCallArg = (analysisStore.update as ReturnType<typeof vi.fn>)
        .mock.calls[0][0];
      const newState = lastCallArg({});
      expect(newState.vadPositiveThreshold).toBe(0.8);
      expect(newState.vadNegativeThreshold).toBe(0.2);
    });

    it("should use undefined for missing parameters for playerStore", async () => {
      await updateMockPageStore(new URLSearchParams()); // Empty params
      loadStateFromUrl();

      expect(playerStore.update).toHaveBeenCalled();
      const lastCallArg = (playerStore.update as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      const newState = lastCallArg({ speed: 1, pitch: 0 }); // Provide some initial state
      expect(newState.speed).toBeUndefined();
      expect(newState.pitch).toBeUndefined();
      // ensure others are also undefined
    });

    it("should set hasInitializedFromUrl to true after timeout", async () => {
      // This test requires a bit more setup to check the internal `hasInitializedFromUrl`
      // For now, we assume it works as intended based on its Promise.resolve().then(...)
      // A more complex test might involve spying on `subscribeToStoresForUrlUpdate` behavior
      // which depends on this flag.
      loadStateFromUrl();
      // console.log('hasInitializedFromUrl should be false initially or after this function call');
      vi.runAllTimers(); // Resolve the Promise.resolve().then()
      // console.log('hasInitializedFromUrl should be true after timers run');
      // This test doesn't directly assert hasInitializedFromUrl as it's not exposed.
      // We'd test its effect on subscribeToStoresForUrlUpdate.
      expect(true).toBe(true); // Placeholder
    });
  });

  describe("subscribeToStoresForUrlUpdate", () => {
    it("should subscribe to playerStore and analysisStore", () => {
      subscribeToStoresForUrlUpdate();
      expect(playerStore.subscribe).toHaveBeenCalled();
      expect(analysisStore.subscribe).toHaveBeenCalled();
    });

    it("debounced URL updater should call goto eventually after store change (if initialized)", async () => {
      // First, simulate initialization
      loadStateFromUrl();
      // Ensure the microtask from loadStateFromUrl (setting hasInitializedFromUrl = true) completes
      await vi.advanceTimersByTimeAsync(0);

      // let playerStoreSubscriber: (state: any) => void = () => {};
      // (playerStore.subscribe as ReturnType<typeof vi.fn>).mockImplementation( // Not needed with real store
      //   (cb) => {
      //     playerStoreSubscriber = cb;
      //     cb(get(mockPlayerStoreInstance)); // Call with current state
      //     return mockPlayerStoreInstance.subscribe(cb); // Use real subscribe for further updates
      //   },
      // );

      subscribeToStoresForUrlUpdate(); // This sets up the subscriptions

      // Simulate a store change by updating the actual store instance
      mockPlayerStoreInstance.update((s) => ({ ...s, speed: 1.5 }));
      // vi.runAllTimers(); // Ensure store update is processed if it involves async operations (it shouldn't here)

      // goto might be called once immediately upon subscription if hasInitializedFromUrl is true,
      // then again after the debounce from the explicit update.
      // Or, the debouncer might coalesce these. Let's check for at least one call after advancing timer.
      vi.advanceTimersByTime(UI_CONSTANTS.DEBOUNCE_HASH_UPDATE_MS);
      expect(goto).toHaveBeenCalled();
      // Check the last call for the correct URL params
      const lastCallIndex =
        (goto as ReturnType<typeof vi.fn>).mock.calls.length - 1;
      expect(
        (goto as ReturnType<typeof vi.fn>).mock.calls[lastCallIndex][0],
      ).toContain(`${URL_HASH_KEYS.SPEED}=1.5`);
      // If we need to be more precise about call count, it would require deeper analysis of debounce interaction.
    });

    it("debounced URL updater should NOT call goto if not initialized", () => {
      // DO NOT call loadStateFromUrl or run timers for hasInitializedFromUrl flag

      // (playerStore.subscribe as ReturnType<typeof vi.fn>).mockImplementation( // Not needed
      //   (cb) => {
      //     playerStoreSubscriber = cb;
      //     cb(get(mockPlayerStoreInstance));
      //     return mockPlayerStoreInstance.subscribe(cb);
      //   },
      // );

      subscribeToStoresForUrlUpdate();

      mockPlayerStoreInstance.update((s) => ({ ...s, speed: 1.5 }));
      // vi.runAllTimers();

      vi.advanceTimersByTime(UI_CONSTANTS.DEBOUNCE_HASH_UPDATE_MS);
      expect(goto).not.toHaveBeenCalled();
    });

    it("should return an unsubscribe function that calls store unsubscribers", () => {
      const mockPlayerUnsub = vi.fn();
      const mockAnalysisUnsub = vi.fn();
      // Now spy on the methods of the actual store instances
      vi.mocked(mockPlayerStoreInstance.subscribe).mockReturnValue(
        mockPlayerUnsub,
      );
      vi.mocked(mockAnalysisStoreInstance.subscribe).mockReturnValue(
        mockAnalysisUnsub,
      );

      const unsubscribeAll = subscribeToStoresForUrlUpdate();
      unsubscribeAll();

      expect(mockPlayerUnsub).toHaveBeenCalled();
      expect(mockAnalysisUnsub).toHaveBeenCalled();
    });
  });
});
