<!-- /CONTRIBUTING-LLM.md -->
# LLM Assistant Collaboration Guidelines

This document outlines the principles and procedures for collaborating with an LLM assistant on software projects. Adherence to these guidelines ensures efficient, maintainable, and architecturally sound development.

## Part 1: Global Principles (Project & Language Agnostic)

*(These principles apply generally, regardless of the specific project or language, unless overridden in Part 2. The project-specific section provides context on how these global principles are applied or modified for a particular project.)*

### Principle 1: Iterative & Confirmative Workflow

*   **Sub-point: Understand -> Discuss -> Confirm -> Generate Process**
    *   **Reason:** Ensures user control over design/architecture, prevents wasted generation cycles, maintains focus.
    *   **Context:** When initiating any non-trivial change (code or documentation).
    *   **Action:** LLM first states understanding, outlines proposed changes (logic/content points only) & implications -> Discuss approach with user -> **Explicitly ask for confirmation** -> Only then generate the specific code/text block.
*   **Sub-point: Focused Change Blocks**
    *   **Reason:** Facilitates user's copy-paste workflow, isolates changes for testing, minimizes token usage for LLM generation.
    *   **Context:** When providing generated code or text as part of the workflow.
    *   **Action:** LLM provides **only one** logical block (single line diff, full function, section, etc.) per response. Keep blocks concise.
*   **Sub-point: Multi-Step Change Tracking**
    *   **Reason:** Provides clarity on progress during sequences of related changes.
    *   **Context:** When a single logical change requires multiple LLM responses to implement fully.
    *   **Action:** LLM uses a tracker (`Fixing X | Fixed: Y | To Be Fixed: Z`) at the start of responses *during* that sequence. Tracker is **dropped** once the sequence is confirmed complete by the user.

### Principle 2: Clarity & Explicit Communication

*   **Sub-point: Proactive Clarification Seeking**
    *   **Reason:** Avoids incorrect assumptions and wasted effort. Leverages user's domain/project knowledge.
    *   **Context:** Whenever requirements, existing code, constraints, or user intent seem ambiguous or underspecified.
    *   **Action:** LLM **must ask** clarifying questions before making assumptions or generating potentially incorrect output.
*   **Sub-point: Explanation of Changes**
    *   **Reason:** Keeps the user informed of the rationale, especially regarding design choices or non-obvious logic. Aids user learning and architectural oversight.
    *   **Context:** When providing any generated code or text block.
    *   **Action:** LLM briefly explains *what* the block does and *why* the specific approach was taken, especially if there were alternatives.

### Principle 3: Maintainability & Consistency

*   **Sub-point: Adherence to Existing Patterns**
    *   **Reason:** Ensures codebase remains cohesive and predictable. Reduces cognitive load for future maintenance (human or LLM).
    *   **Context:** When adding or modifying code or documentation.
    *   **Action:** LLM analyzes existing code/docs to identify prevailing patterns (style, structure, naming, communication methods) and **strictly adheres** to them in generated output.
*   **Sub-point: High-Quality Documentation & Comments (PyCharm Focus)**
    *   **Reason:** Critical for future LLM understanding and maintenance (including historical context), aids human comprehension, enables IDE features.
    *   **Context:** When generating or modifying functions, classes, complex variables, modules, or significant logic blocks.
    *   **Action:** LLM generates comprehensive Doc comments (e.g., JSDoc for JS, compatible with **PyCharm** analysis) including descriptions, parameters (`@param {type}`), returns (`@returns {type}`), and types. Use inline comments for complex logic steps. **Crucially, preserve existing meaningful comments unless the code they refer to is removed. These comments serve as a historical log for future LLM context to understand *why* code evolved.** Maintain documentation alongside code.
*   **Sub-point: File Identification Comments (Full Files Only)**
    *   **Reason:** Allows LLM to identify file context when receiving pasted content; allows user to verify paste location.
    *   **Context:** When generating the *entire content* of a file.
    *   **Action:** LLM includes file path comments at the **absolute start and end** of the generated file content (e.g., `<!-- /path/to/file.html -->`, `// --- /path/to/script.js ---`). Not needed for partial replacements (functions/sections).
*   **Sub-point: Logical Sectioning (Long Files)**
    *   **Reason:** Improves readability and navigation for humans and LLMs. Facilitates targeted section replacements.
    *   **Context:** When working with files containing multiple distinct logical parts.
    *   **Action:** LLM uses clear section header comments (e.g., `// --- Initialization ---`, `/* === API Handlers === */`) to delineate logical blocks.

### Principle 4: Standardized Code Presentation

*   **Reason:** Provides a consistent, predictable format for user review and integration. Balances granularity with ease of use for multiple changes.
*   **Context:** When delivering any code modification.
*   **Action:** LLM uses the following formats *exclusively*, showing *only* the relevant code block:
    *   **Single Line:** Use diff format (`- before\n+ after`).
    *   **Function (1-2 per file):** Provide definition/skeleton (`function name(...) {...}`) in one block, then the complete updated function body (`function name(...) { ... full code ... }`) in a second block. Repeat for a second function if necessary in subsequent responses.
    *   **Section:** Provide the complete section from its start comment to its end comment/next section start.
    *   **Multiple Functions (>2) or Significant Scattered Changes:** Provide the **complete file content**, bracketed by File Identification Comments (see Principle 3). Use this method if more than two functions are modified within the same file during a single logical change sequence.
    *   **Entire File (Initial Generation/Full Rewrite):** Provide complete file content, bracketed by File Identification Comments.

### Principle 5: Phased Lifecycle for Significant Changes

*   **Reason:** Manages risk, validates ideas incrementally, balances development speed with code quality and architectural stability.
*   **Context:** When implementing new features or making substantial modifications.
*   **Action:** LLM proposes and follows this cycle:
    *   **1. Design:** Discuss goals, plan approach, identify architectural impact. Output: Plan, maybe high-level doc updates (`README.md`). **Minimal code generation.**
    *   **2. POC/MVP:** Implement core functionality via **minimal necessary code changes**. Prioritize function over form. Output: Working rough feature, updated usage docs (`README.md`). **Targeted code generation.**
    *   **3. Refactor:** Improve code quality (idiomatic, robust), integrate cleanly, update detailed docs (`architecture.md`). Output: Polished feature, updated `architecture.md`. **Refactoring-focused code generation.**

### Principle 6: File System Operations

*   **Reason:** Clearly distinguishes content changes from file system structure changes.
*   **Context:** When a file needs to be moved, renamed, deleted, or reverted.
*   **Action:** LLM states the operation clearly (e.g., "Move `path/old.js` to `path/new.js`", "Delete `path/unused.css`") instead of generating content.

### Principle 7: Guideline Maintenance & Evolution

*   **Reason:** Ensures the guidelines remain accurate, consistent, and reflect the user's current preferred workflow. Facilitates a smoother collaboration by codifying interaction patterns.
*   **Context:** When the user makes statements during a conversation that conflict with existing guidelines, repeatedly suggest a workflow element not captured, or express a preference that should be standardized.
*   **Action:** LLM **must**:
    1.  **Identify:** Point out the potential conflict or the repeated/new suggestion. (e.g., "You mentioned wanting X, but the current guidelines specify Y. Which should we follow?" or "You've suggested we do Z several times now. Should we add that to the guidelines?").
    2.  **Clarify:** Ask the user to confirm their current preference or the exact rule they want to establish.
    3.  **Propose Update:** Based on the clarification, **propose specific changes** (text additions/modifications) to `CONTRIBUTING-LLM.md` to formally incorporate the new/updated rule. Follow the standard "Discuss -> Confirm -> Generate" process for updating the guidelines document itself.

### Principle 8: README Generation Requirement

*   **Reason:** Ensures project users and future LLMs are aware these collaboration guidelines exist and should be followed for consistency.
*   **Context:** When generating or significantly updating a project's `README.md` file.
*   **Action:** LLM **must** include a statement in the `README.md` (e.g., in a "Developer Notes" or "Contributing" section) advising that development involving LLM assistance should follow the rules outlined in `../CONTRIBUTING-LLM.md` (adjust the relative path from the README's location as needed) and instructing potential contributors/LLMs to request this file if it wasn't provided.

## Part 2: Project-Specific Guidelines (`vibe-player` Example)

*(The following rules supplement or override the Global Principles specifically for the `vibe-player` project, defined by its context (e.g., location, constraints).)*

### Project: Vibe Player (Located at `./vibe-player/` relative to these guidelines)

#### Constraint 1: Static Execution Environment
*   **Reason:** Project requirement for deployment simplicity.
*   **Context:** Core architectural constraint.
*   **Action:** LLM **must not** introduce server-side dependencies, build steps (Webpack, Babel, TS compilation), or features requiring more than static file serving.

#### Constraint 2: Technology Stack (Vanilla JS/HTML/CSS)
*   **Reason:** Project choice for simplicity and avoiding framework dependencies.
*   **Context:** Affects code generation style and available features.
*   **Action:** LLM generates only standards-compliant HTML5, CSS3, and JavaScript (ES6). **No frameworks** (React, Vue, etc.). Adhere to the established ES6 module pattern (IIFEs creating properties on the `AudioApp` namespace).

#### Constraint 3: Namespace & Communication Pattern (`AudioApp`, Events)
*   **Reason:** Defines the project's internal API and interaction flow. Ensures modularity.
*   **Context:** How different parts of the application interact.
*   **Action:** LLM uses the global `AudioApp` object for inter-module calls (`AudioApp.module.method()`). Use `document.dispatchEvent(new CustomEvent('audioapp:...'))` for events originating from UI or decoupled components targeting `app.js`. Worklet communication is mediated *only* via `audioEngine.js`.

#### Constraint 4: Error Handling Pattern
*   **Reason:** Consistent error reporting and user feedback.
*   **Context:** How runtime errors are managed.
*   **Action:** LLM primarily uses `console.error()`. For user-impacting errors, dispatch specific `audioapp:errorType` events for `app.js` to potentially update the UI via `AudioApp.uiManager`.

#### Constraint 5: Testing Approach (Manual/YOLO)
*   **Reason:** Project's chosen testing strategy.
*   **Context:** Verification of changes.
*   **Action:** LLM understands changes are verified manually by the user copy-pasting and running the code. **No automated tests** (unit, integration, e2e) should be generated or expected.

#### Constraint 6: File Structure & Complexity
*   **Reason:** Maintainability for LLM processing and user copy-paste workflow.
*   **Context:** Organization of code.
*   **Action:** LLM should generally avoid merging conceptually distinct modules into single large files or drastically increasing file complexity without prior discussion, even during refactoring. Maintain the modular structure where possible.

<!-- /CONTRIBUTING-LLM.md -->
