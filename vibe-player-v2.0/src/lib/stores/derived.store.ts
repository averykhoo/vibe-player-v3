// vibe-player-v2.0/src/lib/stores/derived.store.ts
import { derived } from "svelte/store";
import { statusStore } from "./status.store";

export const exampleDerived = derived(statusStore, ($statusStore) => ({
  placeholder: true,
}));
