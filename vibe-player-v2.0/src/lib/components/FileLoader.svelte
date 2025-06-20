<!-- vibe-player-v2.0/src/lib/components/FileLoader.svelte -->
<script lang="ts">
    import { playerStore } from '$lib/stores/player.store'; // To show status or file name
    import AudioOrchestrator from '$lib/services/AudioOrchestrator.service';
    import audioEngine from '$lib/services/audioEngine.service';

    let currentFile: File | null = null;
    let isLoading = false;

    async function handleFileSelect(event: Event) {
        // The first action in the event handler MUST be the unlock trigger.
        // It is NOT awaited, allowing it to run in the background.
        audioEngine.unlockAudio(); // <--- THIS IS THE LINE TO ADD

        // Proactively unlock audio context

        const input = event.target as HTMLInputElement;
        if (input.files?.[0]) {
            currentFile = input.files[0];
            console.log(`[FileLoader] File selected: ${currentFile.name}`);
            // playerStore.update(s => ({ ...s, fileName: currentFile?.name, error: null, status: 'File selected', isPlayable: false }));
            isLoading = true;

            try {
                await AudioOrchestrator.loadFileAndAnalyze(currentFile);
            } catch (e: any) {
                console.error('[FileLoader] Error during loadFileAndAnalyze:', e);
                playerStore.update(s => ({ ...s, error: `Failed to load file: ${e.message || 'Unknown error'}`, status: 'Error', isPlayable: false }));
            } finally {
                isLoading = false;
                // Clear the file input so the same file can be re-selected if needed after an error
                input.value = '';
            }
        }
    }
</script>

<div class="card p-4">
    <h3 class="h3 mb-2">Load Audio File</h3>
    <input type="file" id="fileInput" class="input" on:change={handleFileSelect} accept="audio/*" disabled={isLoading} />
    {#if currentFile}
        <p class="mt-2 text-sm">Selected: {currentFile.name} ({ (currentFile.size / 1024 / 1024).toFixed(2) } MB)</p>
    {/if}
    {#if isLoading}
        <p class="mt-2 text-sm">Loading...</p>
    {/if}
    <!-- Status messages from playerStore can be displayed here -->
    {#if $playerStore?.status}
        <p data-testid="file-status-display" class="mt-2 text-sm text-gray-500">Status: {$playerStore.status}</p>
    {/if}
    {#if $playerStore?.error}
        <p class="mt-2 text-sm text-error-500">Error: {$playerStore.error}</p>
    {/if}
</div>
