import { derived } from "svelte/store";
import { statusStore } from "./status.store";
export const exampleDerived = derived(statusStore, ($statusStore) => ({
  placeholder: true,
}));
