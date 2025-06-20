<!-- vibe-player-v2.3/src/lib/components/FileLoader.svelte -->
<script lang="ts">
    import { AudioOrchestrator } from '$lib/services/AudioOrchestrator.service';
    import { statusStore } from '$lib/stores/status.store';

    let selectedFileDisplay: { name: string; size: number } | null = null;

    async function handleFileSelect(event: Event) {
        const input = event.target as HTMLInputElement;
        if (input.files?.[0]) {
            const file = input.files[0];
            selectedFileDisplay = { name: file.name, size: file.size };

            // The component's only job is to dispatch the action.
            AudioOrchestrator.getInstance().loadFileAndAnalyze(file);

            // The 'finally' block is no longer needed here, as the orchestrator handles all state.
            input.value = '';
        }
    }
</script>

<div class="card p-4 space-y-2">
    <label for="fileInput" class="h3 cursor-pointer">Load Audio File</label>
    <input
        type="file"
        id="fileInput"
        class="input"
        on:change={handleFileSelect}
        accept="audio/*"
        disabled={$statusStore.isLoading}
    />

    {#if selectedFileDisplay && !$statusStore.isLoading}
        <p class="text-sm">Selected: {selectedFileDisplay.name} ({(selectedFileDisplay.size / 1024 / 1024).toFixed(2)} MB)</p>
    {/if}

    {#if $statusStore.isLoading}
        <p data-testid="file-loading-message" class="text-sm text-info-500">
            {$statusStore.message || 'Loading...'}
        </p>
    {/if}

    {#if $statusStore.type === 'error' && !$statusStore.isLoading}
        <p data-testid="file-error-message" class="mt-2 text-sm text-error-500">
            Error: {$statusStore.message}
        </p>
    {/if}
</div>
