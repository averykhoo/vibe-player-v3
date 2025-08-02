[//]: # ( vibe-player-v3-docs/docs/refactor-plan/appendix-e-edge-case-logic.md )
# Appendix E: State Machine Edge Case Logic

This appendix provides explicit, mandatory logic for handling specific edge cases within the `AudioOrchestratorService`
state machine.

## E.1. Handling `audioEngine:playbackEnded` Event

When the `AudioEngineService` detects that playback has naturally reached the end, it **emits** an
`audioEngine:playbackEnded` event. The `AudioOrchestratorService`, which subscribes to this event, **must** execute the
following sequence:

1. **Command `AudioEngineService`:** Command the `AudioEngineService` to set its internal playback time to exactly match
   the `duration`. This ensures the UI seek bar moves to the very end.
2. **Transition State:** Transition the application state from `PLAYING` to `READY`. This updates the `playerStore` and
   changes the UI icon from "Pause" to "Play".
3. **Prevent URL Update:** The orchestrator **must not** trigger the `urlState.ts` utility. This is a deliberate
   exception to prevent sharing a URL with a `time=` parameter equal to the duration.

## E.2. Handling `ui:playToggled` Event from `READY` state

When the user clicks "Play" while the application is in the `READY` state, the UI emits a `ui:playToggled` event. The
`AudioOrchestratorService` must:

1. **Check Time:** Check if `currentTime` is equal to (or within a small epsilon of) the `duration`.
2. **Conditional Seek:**
    * If `true`, it must first issue a **seek command to `0`** to the `AudioEngineService`. Only then should it issue
      the `play` command.
    * If `false`, it can immediately issue the `play` command.
3. **Rationale:** This ensures that clicking "Play" on a finished track correctly restarts it from the beginning, which
   is the universally expected behavior.