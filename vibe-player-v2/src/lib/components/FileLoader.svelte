<script lang="ts">
    import audioEngine from '$lib/services/audioEngine.service';
    import { playerStore } from '$lib/stores/player.store'; // To show status or file name

    let currentFile: File | null = null;
    let isLoading = false;

    async function handleFileSelect(event: Event) {
        const input = event.target as HTMLInputElement;
        if (input.files && input.files.length > 0) {
            currentFile = input.files[0];
            playerStore.update(s => ({ ...s, fileName: currentFile?.name, error: null, status: 'File selected', isPlayable: false }));
            isLoading = true;

            try {
                await audioEngine.unlockAudio(); // Ensure AudioContext is ready

                const arrayBuffer = await currentFile.arrayBuffer();
                await audioEngine.loadFile(arrayBuffer, currentFile.name);
                // Status updates will now come from audioEngine via playerStore

            } catch (e: any) {
                console.error('Error processing file:', e);
                playerStore.update(s => ({ ...s, error: `Error processing file: ${e.message}`, isPlayable: false }));
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
        <p class="mt-2 text-sm text-gray-500">Status: {$playerStore.status}</p>
    {/if}
    {#if $playerStore?.error}
        <p class="mt-2 text-sm text-error-500">Error: {$playerStore.error}</p>
    {/if}
</div>
