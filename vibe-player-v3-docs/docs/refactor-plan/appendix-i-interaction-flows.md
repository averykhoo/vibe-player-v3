[//]: # ( vibe-player-v3/docs/refactor-plan/appendix-i-interaction-flows.md )
# Appendix I: Core Interaction Flows

This appendix provides a detailed visual description of key application interactions.

## I.1. Play/Pause Command Flow with Event Emitter (Sequence Diagram)

This diagram shows how a user's "play" command propagates through the decoupled system.

See the [Play/Pause Command Flow](diagrams/play-pause-flow.mermaid) for a visual representation of this interaction.

## I.2. File Loading & Analysis Flow

This diagram shows how loading a new file triggers decoding and parallel background analysis tasks.

See the [File Loading & Analysis Flow](diagrams/file-loading-flow.mermaid) for a visual representation of this interaction.

## I.3. Seek Command Flow

This diagram illustrates the two-phase seek operation (begin/end) and how state is managed to ensure correct playback
resumption.

See the [Seek Command Flow](diagrams/seek-command-flow.mermaid) for a visual representation of this interaction.