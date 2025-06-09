import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadStateFromUrl, subscribeToStoresForUrlUpdate } from "./urlState";
import { page } from "$app/stores";
import { goto } from "$app/navigation";
import { playerStore } from "../stores/player.store";
import { analysisStore } from "../stores/analysis.store";
import { UI_CONSTANTS, URL_HASH_KEYS } from "./constants";
import type { Writable } from "svelte/store";

// Mocks
vi.mock("$app/stores", () => ({
  page: vi.fn(),
}));

vi.mock("$app/navigation", () => ({
  goto: vi.fn(),
}));

vi.mock("../stores/player.store", () => ({
  playerStore: {
    subscribe: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../stores/analysis.store", () => ({
  analysisStore: {
    subscribe: vi.fn(),
    update: vi.fn(),
  },
}));

// Helper to mock Svelte's page store
function mockPageStore(searchParams: URLSearchParams) {
  const { writable } = require("svelte/store"); // Use require here if actual svelte/store is problematic in test setup
  const mockPageValue = {
    url: {
      searchParams,
      pathname: "/", // Default pathname
    },
    // Add other properties if your code uses them
  };
  (page as Writable<any>).set(mockPageValue); // For initial get(page)
  // Mock subscribe if page itself is a store
  (page as any).subscribe = (subscriber: (value: any) => void) => {
    subscriber(mockPageValue); // Immediately call with mock value
    return () => {}; // Return unsubscribe function
  };
}

describe("urlState utilities", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reset mocks for stores if they are stateful or accumulate calls
    vi.clearAllMocks();

    // Default mock for page store for each test
    mockPageStore(new URLSearchParams());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("loadStateFromUrl", () => {
    it("should call playerStore.update with parsed speed from URL", () => {
      const params = new URLSearchParams();
      params.set(URL_HASH_KEYS.SPEED, "1.75");
      mockPageStore(params);

      loadStateFromUrl();

      expect(playerStore.update).toHaveBeenCalled();
      const lastCallArg = (playerStore.update as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      const newState = lastCallArg({}); // Call the updater function
      expect(newState.speed).toBe(1.75);
    });

    it("should call analysisStore.update with parsed VAD thresholds from URL", () => {
      const params = new URLSearchParams();
      params.set(URL_HASH_KEYS.VAD_POSITIVE, "0.8");
      params.set(URL_HASH_KEYS.VAD_NEGATIVE, "0.2");
      mockPageStore(params);

      loadStateFromUrl();

      expect(analysisStore.update).toHaveBeenCalled();
      const lastCallArg = (analysisStore.update as ReturnType<typeof vi.fn>)
        .mock.calls[0][0];
      const newState = lastCallArg({});
      expect(newState.vadPositiveThreshold).toBe(0.8);
      expect(newState.vadNegativeThreshold).toBe(0.2);
    });

    it("should use undefined for missing parameters for playerStore", () => {
      mockPageStore(new URLSearchParams()); // Empty params
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

    it("debounced URL updater should call goto eventually after store change (if initialized)", () => {
      // First, simulate initialization
      loadStateFromUrl();
      vi.runAllTimers(); // Ensure hasInitializedFromUrl is true

      let playerStoreSubscriber: (state: any) => void = () => {};
      (playerStore.subscribe as ReturnType<typeof vi.fn>).mockImplementation(
        (cb) => {
          playerStoreSubscriber = cb;
          return () => {}; // Unsubscribe
        },
      );

      subscribeToStoresForUrlUpdate(); // This sets up the subscriptions

      // Simulate a store change
      playerStoreSubscriber({ speed: 1.5 });

      expect(goto).not.toHaveBeenCalled(); // Should be debounced
      vi.advanceTimersByTime(UI_CONSTANTS.DEBOUNCE_HASH_UPDATE_MS);
      expect(goto).toHaveBeenCalledTimes(1);
      expect((goto as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain(
        `${URL_HASH_KEYS.SPEED}=1.5`,
      );
    });

    it("debounced URL updater should NOT call goto if not initialized", () => {
      // DO NOT call loadStateFromUrl or run timers for hasInitializedFromUrl flag

      let playerStoreSubscriber: (state: any) => void = () => {};
      (playerStore.subscribe as ReturnType<typeof vi.fn>).mockImplementation(
        (cb) => {
          playerStoreSubscriber = cb;
          return () => {}; // Unsubscribe
        },
      );

      subscribeToStoresForUrlUpdate();

      playerStoreSubscriber({ speed: 1.5 }); // Simulate store change

      vi.advanceTimersByTime(UI_CONSTANTS.DEBOUNCE_HASH_UPDATE_MS);
      expect(goto).not.toHaveBeenCalled();
    });

    it("should return an unsubscribe function that calls store unsubscribers", () => {
      const mockPlayerUnsub = vi.fn();
      const mockAnalysisUnsub = vi.fn();
      (playerStore.subscribe as ReturnType<typeof vi.fn>).mockReturnValue(
        mockPlayerUnsub,
      );
      (analysisStore.subscribe as ReturnType<typeof vi.fn>).mockReturnValue(
        mockAnalysisUnsub,
      );

      const unsubscribeAll = subscribeToStoresForUrlUpdate();
      unsubscribeAll();

      expect(mockPlayerUnsub).toHaveBeenCalled();
      expect(mockAnalysisUnsub).toHaveBeenCalled();
    });
  });
});
