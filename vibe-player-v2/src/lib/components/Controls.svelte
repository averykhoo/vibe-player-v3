<!-- vibe-player-v2/src/lib/components/Controls.svelte -->
<script lang="ts">
    import { RangeSlider } from '@skeletonlabs/skeleton';
    import audioEngine from '$lib/services/audioEngine.service';
    import analysisService from '$lib/services/analysis.service';
    import { playerStore } from '$lib/stores/player.store'; // For speed, pitch, gain
    import { analysisStore } from '$lib/stores/analysis.store'; // For VAD thresholds

    // Local state for sliders, to be synced with stores/services
    let speed = $playerStore?.speed || 1.0;
    let pitch = $playerStore?.pitch || 0.0;
    let gain = $playerStore?.gain || 1.0;
    let vadPositive = $analysisStore?.vadPositiveThreshold || 0.5;
    let vadNegative = $analysisStore?.vadNegativeThreshold || 0.35;

    // Subscribe to store changes to update local slider values if they change elsewhere
    playerStore.subscribe(val => {
        if (val.speed !== undefined) speed = val.speed;
        if (val.pitch !== undefined) pitch = val.pitch;
        if (val.gain !== undefined) gain = val.gain;
    });
    analysisStore.subscribe(val => {
        if (val.vadPositiveThreshold !== undefined) vadPositive = val.vadPositiveThreshold;
        if (val.vadNegativeThreshold !== undefined) vadNegative = val.vadNegativeThreshold;
    });

    function handlePlayPause() {
        if ($playerStore.isPlaying) {
            audioEngine.pause();
        } else {
            audioEngine.play();
        }
    }
    function handleStop() {
        audioEngine.stop();
    }

    function updateSpeed() {
        audioEngine.setSpeed(speed);
    }
    function updatePitch() {
        audioEngine.setPitch(pitch);
    }
    function updateGain() {
        audioEngine.setGain(gain); // Call the new service method
    }
    function updateVadThresholds() {
        // analysisService.setVadThresholds(vadPositive, vadNegative); // Example
        console.log('VAD thresholds changed:', vadPositive, vadNegative);
        analysisStore.update(s => ({...s, vadPositiveThreshold: vadPositive, vadNegativeThreshold: vadNegative }));
    }

</script>

<div class="card p-4 space-y-4">
    <h3 class="h3">Controls</h3>
    <div class="flex space-x-2">
        <button type="button" class="btn" data-testid="play-button" on:click={handlePlayPause} disabled={!$playerStore.isPlayable}>
            {$playerStore.isPlaying ? 'Pause' : 'Play'}
        </button>
        <button type="button" class="btn" data-testid="stop-button" on:click={handleStop} disabled={!$playerStore.isPlayable}>Stop</button>
    </div>
    <div>
        <label for="speedSlider" class="label">Speed: {speed.toFixed(2)}x</label>
        <RangeSlider name="speedSlider" bind:value={speed} min={0.5} max={2.0} step={0.01} on:input={updateSpeed} />
    </div>
    <div>
        <label for="pitchSlider" class="label">Pitch: {pitch.toFixed(1)} semitones</label>
        <RangeSlider name="pitchSlider" bind:value={pitch} min={-12} max={12} step={0.1} on:input={updatePitch} />
    </div>
    <div>
        <label for="gainSlider" class="label">Gain: {gain.toFixed(2)}</label>
        <RangeSlider name="gainSlider" bind:value={gain} min={0} max={2.0} step={0.01} on:input={updateGain} />
    </div>
    <div>
        <label for="vadPositiveSlider" class="label">VAD Positive Threshold: {vadPositive.toFixed(2)}</label>
        <RangeSlider name="vadPositiveSlider" bind:value={vadPositive} min={0.05} max={0.95} step={0.01} on:input={updateVadThresholds} />
    </div>
    <div>
        <label for="vadNegativeSlider" class="label">VAD Negative Threshold: {vadNegative.toFixed(2)}</label>
        <RangeSlider name="vadNegativeSlider" bind:value={vadNegative} min={0.05} max={0.95} step={0.01} on:input={updateVadThresholds} />
    </div>
</div>
