// vibe-player-v2/src/lib/utils/async.test.ts
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {debounce, yieldToMainThread} from "./async";

describe("async utilities", () => {
    describe("yieldToMainThread", () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it("should return a Promise", () => {
            expect(yieldToMainThread()).toBeInstanceOf(Promise);
        });

        it("should resolve after a timeout", async () => {
            const promise = yieldToMainThread();
            vi.runAllTimers(); // Or vi.advanceTimersByTime(0)
            await expect(promise).resolves.toBeUndefined();
        });
    });

    describe("debounce", () => {
        let mockFn: ReturnType<typeof vi.fn>;

        beforeEach(() => {
            vi.useFakeTimers();
            mockFn = vi.fn();
        });

        afterEach(() => {
            vi.restoreAllMocks(); // Clears mocks and timers
        });

        it("should call the function only once after multiple rapid calls", () => {
            const debouncedFn = debounce(mockFn, 100);
            debouncedFn();
            debouncedFn();
            debouncedFn();

            expect(mockFn).not.toHaveBeenCalled();
            vi.advanceTimersByTime(100);
            expect(mockFn).toHaveBeenCalledTimes(1);
        });

        it("should call the function after the specified wait time", () => {
            const debouncedFn = debounce(mockFn, 200);
            debouncedFn();

            vi.advanceTimersByTime(199);
            expect(mockFn).not.toHaveBeenCalled();

            vi.advanceTimersByTime(1);
            expect(mockFn).toHaveBeenCalledTimes(1);
        });

        it("should call the function immediately if immediate is true", () => {
            const debouncedFn = debounce(mockFn, 100, true);
            debouncedFn();
            expect(mockFn).toHaveBeenCalledTimes(1);

            // Should not call again after timeout
            vi.advanceTimersByTime(100);
            expect(mockFn).toHaveBeenCalledTimes(1);
        });

        it("should call the function again after wait time if immediate is true and called again after wait", () => {
            const debouncedFn = debounce(mockFn, 100, true);
            debouncedFn(); // immediate call
            expect(mockFn).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(50);
            debouncedFn(); // this call should be ignored as it's within the wait period
            expect(mockFn).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(50); // total 100ms passed
            debouncedFn(); // this should also be ignored as the timeout from the first call is still active
            expect(mockFn).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(100); // total 200ms passed, timeout for first call ended
            debouncedFn(); // New immediate call
            expect(mockFn).toHaveBeenCalledTimes(2);
        });

        it("should pass arguments correctly to the debounced function", () => {
            const debouncedFn = debounce(mockFn, 100);
            const arg1 = "test";
            const arg2 = 123;
            debouncedFn(arg1, arg2);

            vi.advanceTimersByTime(100);
            expect(mockFn).toHaveBeenCalledWith(arg1, arg2);
        });

        it("should maintain `this` context for the debounced function", () => {
            const obj = {method: mockFn, name: "testObject"};
            const debouncedFn = debounce(obj.method, 100);

            // Call it in a way that sets the `this` context to `obj`
            debouncedFn.call(obj);

            vi.advanceTimersByTime(100);
            expect(mockFn).toHaveBeenCalledTimes(1);
            // Check that the context (`this`) inside the mock call was indeed `obj`
            expect(mockFn.mock.contexts[0]).toBe(obj);
        });
    });
});
