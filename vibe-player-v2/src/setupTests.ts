// General setup for Svelte component testing with Vitest and Testing Library
import "@testing-library/svelte/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import {expect, vi} from "vitest";

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Force $app/environment 'browser' to true
vi.mock("$app/environment", () => ({
    browser: true,
    dev: true,
    building: false,
    version: "test-version",
}));

// Mock window.matchMedia for jsdom environment (used by Skeleton UI)
Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(), // deprecated
        removeListener: vi.fn(), // deprecated
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })),
});

// Mock AudioBuffer for jsdom environment
if (typeof global.AudioBuffer === "undefined") {
    global.AudioBuffer = class AudioBuffer {
        // Add any properties or methods your tests might need
        // For instanceof checks, a class definition is sufficient
        public readonly duration: number = 0;
        public readonly length: number = 0;
        public readonly numberOfChannels: number = 0;
        public readonly sampleRate: number = 0;

        getChannelData(_channel: number): Float32Array {
            return new Float32Array(0);
        }

        copyFromChannel(
            _destination: Float32Array,
            _channelNumber: number,
            _bufferOffset?: number,
        ): void {
        }

        copyToChannel(
            _source: Float32Array,
            _channelNumber: number,
            _bufferOffset?: number,
        ): void {
        }
    };
    console.log("Mocked global.AudioBuffer for jsdom.");
}

console.log(
    "Test setup file loaded: @testing-library/svelte/vitest imported, jest-dom matchers extended, $app/environment mocked, and window.matchMedia mocked.",
);

// Mock all @skeletonlabs/skeleton components with a generic one
// IMPORTANT: Adjust the path to Generic.svelte if your __mocks__ directory is elsewhere.
// Assuming Generic.svelte is in src/lib/components/__mocks__/Generic.svelte
// and setupTests.ts is in src/
vi.mock("@skeletonlabs/skeleton", async () => {
    const GenericSvelteMock = await import(
        "./lib/components/__mocks__/Generic.svelte"
        );
    const ButtonMock = await import("./lib/components/__mocks__/Button.svelte");
    const RangeSliderMock = await import(
        "./lib/components/__mocks__/RangeSlider.svelte"
        );
    const ProgressBarMock = await import(
        "./lib/components/__mocks__/ProgressBar.svelte"
        );

    console.log(
        "(setupTests.ts) Loaded specific mocks. GenericSvelteMock.default:",
        GenericSvelteMock.default,
    );

    const specificMocks = {
        Button: ButtonMock.default,
        RangeSlider: RangeSliderMock.default,
        ProgressBar: ProgressBarMock.default,
        storePopup: vi.fn(), // Example utility
    };

    return new Proxy(specificMocks, {
        get: (target, propKey) => {
            const prop = String(propKey);
            if (prop in target) {
                return target[prop];
            }
            // Fallback for any other Svelte component (PascalCase) to GenericSvelteMock
            if (prop[0] >= "A" && prop[0] <= "Z") {
                // console.warn(`(setupTests.ts)   --> Fallback: Returning GenericSvelteMock.default for ${prop}`);
                return GenericSvelteMock.default;
            }
            // console.warn(`(setupTests.ts) Accessing undefined Skeleton export: ${prop}`);
            return undefined; // Or vi.fn() for non-component functions
        },
    });
});

// Add a new console log to confirm this specific mock is applied.
console.log(
    "Global Skeleton mock via specific mocks + Generic fallback is NOW ENABLED.",
);
