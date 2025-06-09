// General setup for Svelte component testing with Vitest and Testing Library
import '@testing-library/svelte/vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
import { expect, vi } from 'vitest';

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Force $app/environment 'browser' to true
vi.mock('$app/environment', () => ({
  browser: true,
  dev: true,
  building: false,
  version: 'test-version',
}));

// Mock window.matchMedia for jsdom environment (used by Skeleton UI)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
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

console.log('Test setup file loaded: @testing-library/svelte/vitest imported, jest-dom matchers extended, $app/environment mocked, and window.matchMedia mocked.');
