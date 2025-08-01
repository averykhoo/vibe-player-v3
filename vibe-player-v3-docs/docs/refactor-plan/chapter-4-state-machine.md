[//]: # ( vibe-player-v3/docs/refactor-plan/chapter-4-state-machine.md )
# Chapter 4: The Application State Machine

The `AudioOrchestratorService` implements the following state machine to manage the application's lifecycle.

Note: there are two seek states because if you are playing, start seeking (playback should pause while seeking), hit the
spacebar (toggle pause), then stop seeking, playback should be paused - and vice versa.

## 4.1. State Diagram

See the [State Machine Diagram](diagrams/state-machine.mermaid) for a visual representation of the state machine.

### Description

The state machine defines the following states:

- **IDLE**: Application started, no audio loaded.
- **LOADING**: Fetching/decoding audio source.
- **READY**: Audio loaded, playback is paused.
- **PLAYING**: Audio is currently playing.
- **SEEK_AND_RESUME**: User seeking while PLAYING.
- **SEEK_AND_HOLD**: User seeking while READY.
- **ERROR**: A critical, unrecoverable error occurred.

Transitions between states are triggered by commands (user actions) and events (system notifications). For a detailed description of each state and the actions performed during transitions, see [Chapter 4: The Application State Machine](../chapter-4-state-machine.md).



## 4.2. State Definition Table

| State Name            | Description                               | Entry Actions (What the Orchestrator commands)                                                                                     | Allowed Commands (Triggers for leaving)                                                     |
|:----------------------|:------------------------------------------|:-----------------------------------------------------------------------------------------------------------------------------------|:--------------------------------------------------------------------------------------------|
| **`IDLE`**            | Application started, no audio loaded.     | <ul><li>Update `playerStore` status to 'idle'.</li><li>Eagerly initialize background services.</li></ul>                           | <ul><li>`COMMAND_LOAD_AUDIO`</li></ul>                                                      |
| **`LOADING`**         | Fetching/decoding audio source.           | <ul><li>Update `playerStore` status to 'loading'.</li><li>Show global spinner, disable controls.</li></ul>                         | <ul><li>(Internal events only)</li></ul>                                                    |
| **`READY`**           | Audio loaded, playback is paused.         | <ul><li>Update `playerStore` status to 'ready'.</li><li>Hide spinner, enable controls.</li><li>Trigger background analysis.</li></ul>  | <ul><li>`COMMAND_PLAY`</li><li>`COMMAND_BEGIN_SEEK`</li><li>`COMMAND_LOAD_AUDIO`</li></ul>  |
| **`PLAYING`**         | Audio is currently playing.               | <ul><li>Update `playerStore` status to **'playing'**.</li><li>The `isPlaying` derived store will now automatically evaluate to `true`.</li><li>Calls `this.audioEnginePort.play()` to start playback and the `rAF` loop.</li></ul> | <ul><li>`COMMAND_PAUSE`</li><li>`COMMAND_BEGIN_SEEK`</li><li>`COMMAND_LOAD_AUDIO`</li></ul>  |
| **`SEEK_AND_HOLD`**   | User seeking while `READY`.               | <ul><li>Update `playerStore` status to 'seeking'.</li></ul>                                                                        | <ul><li>`COMMAND_END_SEEK`</li><li>`COMMAND_PLAY`</li></ul>                                  |
| **`ERROR`**           | A critical, unrecoverable error occurred. | <ul><li>Update `playerStore` status to 'error', `error` with message.</li><li>Disable controls, display error.</li></ul>           | <ul><li>`COMMAND_LOAD_AUDIO`</li></ul>                                                      |

## 4.3. Handling Special Events & Edge Cases

* **`EVENT_PLAYBACK_ENDED`:** When notified by the `AudioEngineService` that playback has naturally finished:
    1. The orchestrator commands the `AudioEngineService` to set `currentTime` to `duration`.
    2. It transitions the application state to `READY`.
    3. It **must not** trigger a URL state update, to prevent sharing a URL with the time stuck at the end.

* **`COMMAND_PLAY` (from `READY` at End of Track):**
    1. The orchestrator checks if `currentTime === duration`.
    2. If `true`, it first issues a **seek command to `0`** to the `AudioEngineService` before issuing the `play`
       command.
    3. If `false`, it issues the `play` command directly. This ensures clicking "Play" on a finished track restarts it
       from the beginning.