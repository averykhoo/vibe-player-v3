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
            // Log message to confirm user action, as requested
            console.log(`[FileLoader] User selected file: '${file.name}'. Calling AudioOrchestrator.loadFileAndAnalyze.`);

            isLoading = true;
            errorStore.set(null); // Clear previous specific errors from errorStore

            // Call the orchestrator.
            // We don't need to await it here if the orchestrator handles all store updates
            // for status and errors. The UI will react to those store changes.
            AudioOrchestrator.getInstance().loadFileAndAnalyze(file)
                .then(() => {
                    console.log(`[FileLoader] AudioOrchestrator.loadFileAndAnalyze promise resolved for ${file.name}.`);
                    // Orchestrator is responsible for updating playerStore.status to 'Ready' or 'Error'
                })
                .catch((e: any) => {
                    // This catch is a minimal fallback.
                    // The AudioOrchestrator's internal try/catch should handle most errors
                    // and update playerStore.status and playerStore.error appropriately.
                    console.error('[FileLoader] Orchestrator.loadFileAndAnalyze promise rejected:', e);
                    // If orchestrator hasn't set an error in playerStore, set a generic one.
                    if (get(playerStore).status !== 'Error') {
                         playerStore.update(s => ({ ...s, status: 'Error', error: `File processing failed: ${e.message || 'Unknown error'}`}));
                    }
                })
                .finally(() => {
                    isLoading = false;
                    // Clear the file input so the same file can be re-selected
                    if (input) {
                        input.value = '';
                    }
                });
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
        <p class="mt-2 text-sm">Loading audio...</p> <!-- Simplified loading message -->
    {/if}
    <!-- Status messages from playerStore -->
    {#if $playerStore?.status && $playerStore.status !== 'Stopped' && $playerStore.status !== 'Ready' && !isLoading}
        <!-- Show playerStore.status only if not actively "isLoading" locally, to avoid duplicate messages -->
        <p data-testid="file-status-display" class="mt-2 text-sm { $playerStore.status === 'Error' ? 'text-error-500' : 'text-gray-500'}">
            Status: {$playerStore.status}
            {#if $playerStore.status === 'Error' && $playerStore.error}
                : {$playerStore.error}
            {/if}
        </p>
    {/if}
    <!-- Specific error messages from errorStore (if used by orchestrator for non-critical UI hints) -->
    {#if $errorStore?.message && $playerStore.status !== 'Error'} <!-- Avoid double display if playerStore already shows error -->
        <p class="mt-2 text-sm text-warning-500">Note: {$errorStore.message}</p>
    {/if}
</div>
