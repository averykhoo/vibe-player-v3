<!-- vibe-player-v2.3/src/lib/components/FileLoader.svelte -->

<script lang="ts">
    import { AudioOrchestrator } from '$lib/services/AudioOrchestrator.service';
    import { statusStore } from '$lib/stores/status.store'; // Changed from error.store
    // playerStore might not be needed directly here if statusStore handles all UI feedback for loading/errors.
    // import { get } from 'svelte/store'; // get might not be needed if not reading playerStore directly for errors.

    let selectedFileDisplay: { name: string; size: number } | null = null;
    // Local isLoading for input disable is fine, but primary UI feedback comes from statusStore.
    let isInputDisabled = false;

    async function handleFileSelect(event: Event) {
        const input = event.target as HTMLInputElement;
        if (input.files && input.files.length > 0) {
            const file = input.files[0];
            selectedFileDisplay = { name: file.name, size: file.size };
            console.log(`[FileLoader] User selected file: '${file.name}'. Calling AudioOrchestrator.loadFileAndAnalyze.`);

            isInputDisabled = true;
            // AudioOrchestrator is responsible for setting loading status in statusStore.
            // Any errors during loading should also be set in statusStore by the orchestrator.
            try {
                await AudioOrchestrator.getInstance().loadFileAndAnalyze(file);
                console.log(`[FileLoader] AudioOrchestrator.loadFileAndAnalyze promise resolved for ${file.name}.`);
            } catch (e: any) {
                // This catch is a safety net. Orchestrator should ideally handle its own errors
                // and update the statusStore accordingly.
                console.error('[FileLoader] Orchestrator.loadFileAndAnalyze threw or promise rejected:', e);
                // If statusStore wasn't updated by orchestrator on error, set a generic message.
                if ($statusStore.type !== 'error') {
                    statusStore.set({
                        message: `File processing failed: ${e.message || 'Unknown error'}`,
                        type: 'error',
                        isLoading: false,
                        details: e.stack,
                        progress: null
                    });
                }
            } finally {
                isInputDisabled = false;
                // Clear the file input so the same file can be re-selected
                if (input) {
                    input.value = '';
                }
                // selectedFileDisplay = null; // Optionally clear selection display after processing
            }
        }
    }
</script>

<div class="card p-4 space-y-2">
    <label for="fileInput" class="h3 cursor-pointer">Load Audio File</label>
    <input
        type="file"
        id="fileInput"
        class="input variant-form-material"
        on:change={handleFileSelect}
        accept="audio/*"
        disabled={$statusStore.isLoading || isInputDisabled}
    />
    {#if selectedFileDisplay && !$statusStore.isLoading}
        <p class="text-sm">
            Selected: {selectedFileDisplay.name} ({ (selectedFileDisplay.size / 1024 / 1024).toFixed(2) } MB)
        </p>
    {/if}

    {#if $statusStore.isLoading}
        <p data-testid="file-loading-message" class="text-sm text-info-500">
            {$statusStore.message || 'Loading audio...'}
            {#if typeof $statusStore.progress === 'number'}
                ({($statusStore.progress * 100).toFixed(0)}%)
            {/if}
        </p>
    {/if}

    {#if $statusStore.type === 'error' && $statusStore.message && !$statusStore.isLoading}
        <p data-testid="file-error-message" class="mt-2 text-sm text-error-500">
            Error: {$statusStore.message}
            {#if $statusStore.details}
                <span class="text-xs"><br />Details: {$statusStore.details}</span>
            {/if}
        </p>
    {/if}

    {#if $statusStore.type === 'success' && $statusStore.message && !$statusStore.isLoading && $statusStore.message !== 'Ready'}
        <!-- Show non-critical success messages if they are not "Ready" (which implies file loaded) -->
        <p data-testid="file-success-message" class="mt-2 text-sm text-success-500">
            {$statusStore.message}
        </p>
    {/if}
</div>
