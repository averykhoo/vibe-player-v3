<!-- vibe-player-v2/src/lib/components/FileLoader.svelte -->

<script lang="ts">
    import { AudioOrchestrator } from '$lib/services/AudioOrchestrator.service';
    import { playerStore } from '$lib/stores/player.store'; // Used for displaying status/error messages from the store
    import { errorStore } from '$lib/stores/error.store'; // To display specific errors from the orchestrator
    import { get } from 'svelte/store';

    let selectedFileDisplay: { name: string; size: number } | null = null;
    let isLoading = false; // Local loading state for the file input interaction

    async function handleFileSelect(event: Event) {
        const input = event.target as HTMLInputElement;
        if (input.files && input.files.length > 0) {
            const file = input.files[0];
            selectedFileDisplay = { name: file.name, size: file.size };
            console.log(`[FileLoader] User selected file: ${file.name}, size: ${file.size} bytes`);
            isLoading = true;
            errorStore.set(null); // Clear previous errors before new load attempt

            try {
                // AudioOrchestrator.getInstance() will handle everything including engine unlocking,
                // decoding, analysis, and updating relevant stores (playerStore, errorStore, etc.)
                await AudioOrchestrator.getInstance().loadFileAndAnalyze(file);
                console.log(`[FileLoader] AudioOrchestrator.loadFileAndAnalyze call completed for ${file.name}.`);
                // UI updates (status, errors, etc.) will now be driven by store subscriptions.
            } catch (e: any) {
                // This catch block now primarily handles errors if loadFileAndAnalyze itself throws
                // synchronously, or if there's an issue not caught by the orchestrator's internal try/catch.
                // Most detailed errors should be set into errorStore by the orchestrator.
                console.error('[FileLoader] Error during file selection or initial orchestration call:', e);
                // errorStore might already be set by the orchestrator, but if not:
                if (!get(errorStore)) {
                    errorStore.set({ message: `Failed to initiate loading: ${e.message || 'Unknown error'}` });
                }
            } finally {
                isLoading = false;
                // Clear the file input so the same file can be re-selected
                input.value = '';
            }
        }
    }
</script>

<div class="card p-4">
    <h3 class="h3 mb-2">Load Audio File</h3>
    <input type="file" id="fileInput" class="input" on:change={handleFileSelect} accept="audio/*" disabled={isLoading} />
    {#if selectedFileDisplay}
        <p class="mt-2 text-sm">Selected: {selectedFileDisplay.name} ({ (selectedFileDisplay.size / 1024 / 1024).toFixed(2) } MB)</p>
    {/if}
    {#if isLoading}
        <p class="mt-2 text-sm">Loading (handing off to orchestrator)...</p>
    {/if}
    <!-- Status messages from playerStore can be displayed here -->
    {#if $playerStore?.status && $playerStore.status !== 'Stopped' && $playerStore.status !== 'Ready'}
        <p data-testid="file-status-display" class="mt-2 text-sm text-gray-500">Player Status: {$playerStore.status}</p>
    {/if}
    {#if $errorStore?.message}
        <p class="mt-2 text-sm text-error-500">Error: {$errorStore.message}</p>
    {/if}
</div>
