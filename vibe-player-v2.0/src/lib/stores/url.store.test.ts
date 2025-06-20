import { get } from "svelte/store";
import { playerStore } from "./player.store";
import { analysisStore } from "./analysis.store";
import { urlParamsStore, updateUrlWithCurrentTime } from "./url.store";
import { updateUrlWithParams } from "$lib/utils";
import { URL_HASH_KEYS } from "$lib/utils/constants";

// Mock dependencies
vi.mock("./player.store", () => ({
  playerStore: { subscribe: vi.fn(), set: vi.fn(), update: vi.fn() },
}));

vi.mock("./analysis.store", () => ({
  analysisStore: { subscribe: vi.fn(), set: vi.fn(), update: vi.fn() },
}));

vi.mock("$lib/utils", () => ({
  updateUrlWithParams: vi.fn(),
  // Ensure other exports from utils that url.store might use are also mocked if necessary
  // For this test, URL_HASH_KEYS is used by the test itself, not the store directly from $lib/utils
}));

describe("url.store", () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();

    // Mock get from svelte/store
    // It's important this mock is set up correctly.
    // If `get` is not properly mocked here, tests might fail or use actual implementation.
    const svelteStoreMock = vi.hoisted(() => ({
      get: vi.fn(),
      derived: vi.fn(), // Mock derived if urlParamsStore relies on it being mocked
      writable: vi.fn(), // Mock writable if any base stores are writable and need mocking
    }));
    vi.mock("svelte/store", () => svelteStoreMock);
  });

  // describe('urlParamsStore', () => {
  //   it('should derive params correctly and omit currentTime', () => {
  //     // Mock the underlying stores' values for a specific test case
  //     (get as vi.Mock).mockImplementation((store: any) => {
  //       if (store === playerStore) {
  //         return { /* playerStore state without currentTime or with it, to test omission */
  //           speed: 1.5,
  //           pitch: 2,
  //           gain: 0.5,
  //           currentTime: 123.45
  //         };
  //       }
  //       if (store === analysisStore) {
  //         return { /* analysisStore state */
  //           threshold: -40,
  //           smoothing: 0.2
  //         };
  //       }
  //       return {};
  //     });

  //     // Since urlParamsStore is a derived store, its value is determined by its dependencies.
  //     // We need to trigger a subscription or get its value to test it.
  //     // For this test, we'll simulate a subscription to get the derived value.
  //     // Note: Testing derived stores can be tricky; direct value access might be simpler if possible.
  //     // However, the issue description implies urlParamsStore itself doesn't need to change,
  //     // just that it *already* correctly omits currentTime.
  //     // This test is more of a confirmation of existing behavior.

  //     // To actually get the value of a derived store, you typically subscribe to it.
  //     // Or, if it's used internally by `updateUrlWithCurrentTime` via `get(urlParamsStore)`,
  //     // we can trust that `get` will resolve it.
  //     // For simplicity, let's assume `urlParamsStore` is structured such that its derivation logic
  //     // correctly omits `currentTime`. The main focus is `updateUrlWithCurrentTime`.

  //     // This test might need adjustment based on how urlParamsStore is implemented
  //     // and how its value can be accessed in a test environment.
  //     // For now, we'll focus on updateUrlWithCurrentTime and assume urlParamsStore is correct.
  //     // A more robust test would involve subscribing and checking the emitted value.
  //   });
  // });

  describe("updateUrlWithCurrentTime", () => {
    it("should call updateUrlWithParams with time when currentTime > 0.1", () => {
      const mockParams = { speed: "1.0", pitch: "0" };
      const mockCurrentTime = 15.678;
      (get as vi.Mock).mockImplementation((store: any) => {
        if (store === urlParamsStore) return mockParams;
        if (store === playerStore) return { currentTime: mockCurrentTime };
        return {};
      });

      updateUrlWithCurrentTime();

      expect(updateUrlWithParams).toHaveBeenCalledWith({
        ...mockParams,
        [URL_HASH_KEYS.TIME]: mockCurrentTime.toFixed(2),
      });
    });

    it("should call updateUrlWithParams without time when currentTime <= 0.1", () => {
      const mockParams = { speed: "1.0" };
      const mockCurrentTime = 0.05;
      (get as vi.Mock).mockImplementation((store: any) => {
        if (store === urlParamsStore) return mockParams;
        if (store === playerStore) return { currentTime: mockCurrentTime };
        return {};
      });

      updateUrlWithCurrentTime();

      expect(updateUrlWithParams).toHaveBeenCalledWith(mockParams);
      // Check that TIME key is not present
      const calledArgs = (updateUrlWithParams as vi.Mock).mock.calls[0][0];
      expect(calledArgs.hasOwnProperty(URL_HASH_KEYS.TIME)).toBe(false);
    });

    it("should remove time parameter if currentTime is 0 or very close to 0", () => {
      // urlParamsStore by design should not contain the TIME key.
      // The updateUrlWithCurrentTime function takes parameters from urlParamsStore
      // and ADDS or REMOVES the TIME key based on playerStore's currentTime.
      const mockParamsFromUrlStore = { speed: "1.0" }; // Params as they would be from urlParamsStore (no TIME)
      const mockCurrentTime = 0;

      (get as vi.Mock).mockImplementation((store: any) => {
        if (store === urlParamsStore) return mockParamsFromUrlStore;
        if (store === playerStore) return { currentTime: mockCurrentTime };
        return {};
      });

      updateUrlWithCurrentTime();

      // updateUrlWithParams should be called with params where TIME is explicitly removed/not added.
      expect(updateUrlWithParams).toHaveBeenCalledWith(mockParamsFromUrlStore);
      const calledArgs = (updateUrlWithParams as vi.Mock).mock.calls[0][0];
      expect(calledArgs.hasOwnProperty(URL_HASH_KEYS.TIME)).toBe(false);
    });

    it("should not run on server side (window is undefined)", () => {
      const originalWindow = global.window;
      // @ts-ignore
      delete global.window; // Simulate server-side

      updateUrlWithCurrentTime();
      expect(updateUrlWithParams).not.toHaveBeenCalled();

      global.window = originalWindow; // Restore window
    });
  });
});
