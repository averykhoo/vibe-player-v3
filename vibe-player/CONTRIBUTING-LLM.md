<!-- /CONTRIBUTING-LLM.md -->
# LLM Assistant Collaboration Guidelines

This document outlines the principles and procedures for collaborating with an LLM assistant on software projects. Adherence to these guidelines ensures efficient, maintainable, and architecturally sound development, particularly suited for iterative or "vibe coding" workflows where clear communication and user oversight are paramount.

*(**Note on "Vibe Coding":** This term, popularized by Andrej Karpathy, refers to a development approach heavily reliant on LLMs, where the programmer guides the process with natural language descriptions, reviews/tests the generated code, and iterates, potentially without deep manual familiarity with every line written by the AI initially. These guidelines aim to make such collaboration effective and safe.)*

## Part 1: Global Principles (Project & Language Agnostic)

*(These principles apply generally, unless overridden in Part 2. Principles are labeled P1, P2, etc. Specific rules within a principle are numbered, e.g., P1.1 refers to the first rule under Principle 1.)*

### P1: Iterative & Confirmative Workflow

1.  **Understand -> Discuss -> Confirm -> Generate Process**
    *   **Reason:** Ensures user control over design/architecture, prevents wasted generation cycles, maintains focus.
    *   **Context:** When initiating any non-trivial change (code or documentation).
    *   **Action:** LLM first states understanding, outlines proposed changes (logic/content points only) & implications -> Discuss approach with user -> **Explicitly ask for confirmation** -> Only then generate the specific code/text block.

2.  **One Actionable Block Per Response**
    *   **Reason:** Prevents excessively long responses, making it easier for the user to review, copy, paste, and test individual changes without excessive scrolling. Isolates changes.
    *   **Context:** When delivering *any* generated output requiring user action (code block, documentation section, file content).
    *   **Action:** LLM **must** provide only **one** distinct actionable block (e.g., one function replacement, one documentation section, one file) per response.

3.  **Sequenced Task Tracking & Execution**
    *   **Reason:** Provides clarity on progress during complex tasks involving multiple steps or outputs. Ensures user control over the flow.
    *   **Context:** When a single logical goal requires multiple LLM responses (e.g., modifying several files, generating multiple related functions, updating docs then code).
    *   **Action:** LLM uses a Markdown list/checklist tracker at the start of the *first* response in the sequence. For each subsequent step:
        1.  Update the tracker (e.g., check off completed items).
        2.  Generate the **one** block for the *current* step according to Principle 4 (Standardized Code Presentation & Granularity).
        3.  Explicitly **ask for user confirmation** ("Ready to proceed with the next step: [description]?") before generating the output for the next item in the sequence.
        4.  **Stop showing the tracker** once the entire sequence is confirmed complete by the user.
    *   **Example Tracker (Python context):**
        ```markdown
        Tracker:
        - [x] Update function `calculate_total` in `utils.py`
        - [ ] Add documentation for `calculate_total`
        - [ ] Update `README.md` usage example
        ```

### P2: Clarity & Explicit Communication

1.  **Proactive Clarification Seeking**
    *   **Reason:** Avoids incorrect assumptions and wasted effort. Leverages user's domain/project knowledge.
    *   **Context:** Whenever requirements, existing code, constraints, or user intent seem ambiguous or underspecified.
    *   **Action:** LLM **must ask** clarifying questions before making assumptions or generating potentially incorrect output.

2.  **Explanation of Changes**
    *   **Reason:** Keeps the user informed of the rationale, especially regarding design choices or non-obvious logic. Aids user learning and architectural oversight.
    *   **Context:** When providing any generated code or text block.
    *   **Action:** LLM briefly explains *what* the block does and *why* the specific approach was taken (outside the code block itself), especially if there were alternatives.

### P3: Maintainability & Consistency

1.  **Adherence to Existing Patterns (Context-Dependent)**
    *   **Reason:** Ensures codebase remains cohesive during initial development and allows for controlled improvements later. Reduces cognitive load.
    *   **Context:** When adding or modifying code or documentation.
    *   **Action:**
        *   During initial implementation or the **POC/MVP phase** (see P5): LLM analyzes existing code/docs to identify prevailing patterns (style, structure, naming) and **strictly adheres** to them to minimize disruption.
        *   During the **Refactor phase** (see P5): Adherence to initial patterns can be relaxed *if discussed and confirmed with the user*. **LLM is encouraged to proactively propose** deviations, refactoring, or rewrites if they significantly improve code health, maintainability, performance, or align better with best practices, explaining the rationale clearly. The goal is improvement, not just preserving the initial state.

2.  **High-Quality Documentation & Comments**
    *   **Reason:** Critical for future LLM understanding and maintenance (including historical context), aids human comprehension, enables IDE features.
    *   **Context:** When generating or modifying functions, classes, complex variables, modules, or significant logic blocks.
    *   **Action:**
        *   LLM generates comprehensive Doc comments compatible with project standards (specified in Part 2). Include descriptions, parameters, returns, types, and potentially exceptions/raises where applicable based on the standard.
        *   Use inline comments for complex logic steps.
        *   **Crucially, preserve existing meaningful comments unless the code they refer to is removed. These comments serve as a historical log for future LLM context to understand *why* code evolved.** Maintain documentation alongside code.
    *   **Example Documentation Standards (Specify in Part 2):**
        *   **JSDoc (for JavaScript):** Use tags like `@param {type} name - Description`, `@returns {type} Description`.
        *   **reStructuredText (reST - often for Python):** Use format like `:param name: Description\n:type name: str`, `:returns: Description\n:rtype: type`, `:raises ExceptionType: Reason`. **Types should be inlined with arguments (`:type name: str`)**.
        *   *(Other standards like Google Style (Python), XML Docs (C#), etc., may be specified in Part 2)*

3.  **Conciseness and Non-Redundancy in Documentation**
    *   **Reason:** Optimizes LLM processing time/cost, reduces noise for human readers, improves maintainability of the documentation itself (including these guidelines).
    *   **Context:** When generating or updating *any* documentation, including `CONTRIBUTING-LLM.md`, `README.md`, `architecture.md`, or code comments/docstrings.
    *   **Action:** LLM should strive for concise language in all generated text (docs, comments, explanations). Avoid redundancy. Use precise terminology. However, when explaining complex logic or design choices, **prioritize the clarity needed for both human and future LLM understanding**, even if it requires slightly more detail than absolute minimum brevity would allow. When updating these guidelines (`CONTRIBUTING-LLM.md`), apply this principle recursively.

4.  **File Identification Comments (Full Files Only)**
    *   **Reason:** Allows LLM to identify file context when receiving pasted content; allows user to verify paste location.
    *   **Context:** When generating the *entire content* of a file (as per P4).
    *   **Action:** LLM includes file path comments at the **absolute start and end** of the generated file content (e.g., `# /path/to/script.py`, `<!-- /path/to/file.html -->`). Use the appropriate comment style for the file type. Not needed for partial replacements.

5.  **Logical Sectioning (Long Files)**
    *   **Reason:** Improves readability and navigation for humans and LLMs. Facilitates targeted section replacements.
    *   **Context:** When working with files containing multiple distinct logical parts.
    *   **Action:** LLM uses clear section header comments (e.g., `# --- Initialization ---`, `/* === API Handlers === */`) to delineate logical blocks. Use the appropriate comment style.

### P4: Standardized Code Presentation & Granularity

1.  **Use Most Granular Applicable Format**
    *   **Reason:** Provides a consistent, predictable format for user review and integration. Balances granularity (to **minimize unintended changes** and ease review) with practicality (to avoid excessive back-and-forth for localized multi-line edits). Ensures clarity by separating code from explanation.
    *   **Context:** When delivering any code modification.
    *   **Action:** LLM **must** use the **most granular applicable format** from the hierarchy below, showing *only* the relevant code block. **Code blocks must contain only the code itself (including necessary code comments) and no extra explanatory text or non-code annotations.** Explanations belong *outside* the code block.
        1.  **Single Line Changes (Highest Priority):**
            *   **Condition:** Only one line is added, deleted, or modified.
            *   **Format:** Use diff format (`- before\n+ after`).
        2.  **Function Replacement (Two-Step for Confirmation - Fallback 1):**
            *   **Condition:** Changes involve multiple lines *but are confined entirely within a single function*. **This includes modifying only one function block.**
            *   **Format:**
                *   **Step 1 (Boundary Confirmation):** Provide the function's signature/declaration line and its final closing brace/line, with an indicator for the omitted content. Ask for confirmation that this is the correct function and scope to replace.
                    *   *Example (Python):*
                        ```python
                        def calculate_total(items):
                            # ... function body lines omitted ...
                            return total
                        ```
                *   **Step 2 (Full Replacement):** After user confirmation, provide the complete, updated function body (including signature and contents) in a single code block.
                    ```python
                    def calculate_total(items):
                       # ... NEW full code ...
                       return total
                    ```
            *   **Reason for Two Steps:** Allows user to easily verify the exact start and end points for replacement in their editor before receiving the full code block.
        3.  **Section Replacement (Fallback 2 - Less Common):**
            *   **Condition:** Changes span multiple lines across adjacent functions *strictly within the same logical section* (bounded by section comments like `# --- Section Name ---`), or involve structural changes within that section but outside specific functions. **This applies *only if* changes affect exactly two distinct logical blocks (e.g., two adjacent functions) within the same marked section.**
            *   **Format:** Provide the complete section from its starting marker comment up to (but not including) the starting marker comment of the *next* logical section, or to the section's explicit end marker if used.
        4.  **Entire File Replacement (Fallback 3 - More Common):**
            *   **Condition:** Changes affect **more than two distinct logical blocks** within the file (e.g., modifying two functions and the export list, adding a new function and modifying an existing one, etc.); OR changes are widespread across multiple, non-adjacent sections; OR significantly alter the file's overall structure; OR involve numerous scattered edits making section/function replacement impractical; OR are required for initial file creation or a complete rewrite requested by the user.
            *   **Format:** Provide the complete file content, bracketed by File Identification Comments (see P3.4). **Explicitly state why this format is necessary** (e.g., "Generating full file due to changes in functions X and Y, and the module export list."). **Avoid this format for strictly localized changes covered by formats 1 or 2.**

### P5: Phased Lifecycle for Significant Changes

1.  **Follow Design -> POC/MVP -> Refactor Cycle**
    *   **Reason:** Manages risk, validates ideas incrementally, balances development speed with code quality and architectural stability, especially when dealing with complex changes or overall codebase health.
    *   **Context:** When implementing new features, making substantial modifications, or undertaking dedicated refactoring efforts to improve overall codebase health. Note that multiple Design -> MVP cycles might occur before a dedicated Refactor phase.
    *   **Action:** LLM proposes and follows this cycle:
        *   **1. Design:**
            *   Discuss goals, plan approach, identify architectural impact. **Review if the proposed approach conflicts with or necessitates changes to Project-Specific Constraints (Part 2).**
            *   Output: Plan, maybe high-level doc updates (`README.md`), initial architectural notes (if applicable), **proposed updates to Part 2 constraints if needed.** **Minimal code generation.**
        *   **2. POC/MVP:**
            *   Implement core functionality via **minimal necessary code changes**. Prioritize function over form. **Strictly adhere to existing patterns (P3.1).**
            *   This phase is iterative; expect internal cycles of generation, testing, and bug fixing based on user feedback until the core functionality works.
            *   **Add inline code comments explaining immediate, localized implementation choices or reasons for rejecting quick alternatives at that specific point.**
            *   Output: Working rough feature/functionality, updated usage docs (`README.md`), **localized rationale in code comments.** **Targeted code generation.**
        *   **3. Refactor:**
            *   Improve code quality (idiomatic, robust), integrate cleanly, update detailed docs, address technical debt. **This is the phase where the LLM is actively encouraged (per P3.1) to propose and discuss significant improvements, potentially including rewrites of sections or the entire codebase, if beneficial for long-term health.** The goal is not just polishing one feature, but improving the overall quality and maintainability of the affected code, potentially spanning multiple modules or the entire project. Treat "improving codebase health" as a valid goal for this phase.
            *   **Review POC/MVP comments: Migrate significant architectural rationale, major rejected alternatives, or fundamental limitations discovered to `architecture.md`. Remove or refine purely temporary/obsolete comments.**
            *   Output: Improved codebase structure/quality. **Updated `architecture.md` (reflecting final design and migrated rationale).** Cleaned-up code comments. **Refactoring-focused code generation (potentially including full file replacements per P4.1.4).**

### P6: Dependency Management Clarity

1.  **Explicitly State and Confirm Dependency Changes**
    *   **Reason:** Ensures the user is aware of changes to external libraries or packages the project relies on.
    *   **Context:** Whenever adding, removing, or updating project dependencies is necessary (often during MVP or Refactor phases).
    *   **Action:** LLM **must explicitly state** any necessary additions, removals, or version changes to project dependency files (e.g., `package.json`, `requirements.txt`, `pom.xml`). This statement should be made *before* generating code that relies on the changed dependencies. Present dependency changes clearly and separately from application code changes. Ask for confirmation before proceeding if the change seems significant or potentially breaking.

### P7: File System Operations

1.  **Clearly State File System Operations**
    *   **Reason:** Clearly distinguishes content changes from file system structure changes.
    *   **Context:** When a file needs to be moved, renamed, deleted, or reverted.
    *   **Action:** LLM states the operation clearly (e.g., "Move `path/old.py` to `path/new.py`", "Delete `path/unused.css`") instead of generating content.

### P8: Guideline Maintenance, Evolution & Viability

1.  **Proactive Viability Check on Load**
    *   **Reason:** To proactively identify guidelines **(both Global Principles and Project-Specific Constraints)** that might be suboptimal or outdated due to advancements in LLM capabilities, changes in general or technology-specific best practices, or potential internal inconsistencies, ensuring the collaboration framework remains efficient and effective.
    *   **Context:** To be performed *once* when these guidelines (`CONTRIBUTING-LLM.md`) are first provided or loaded as context at the beginning of a significant work session or project phase for an existing project. *(Note: For brand new projects, Part 2 constraints are typically defined collaboratively first.)*
    *   **Action:**
        1.  LLM performs a **brief internal review** of the loaded guidelines (**including both Part 1 and the applicable Part 2 section**).
        2.  It compares the principles, workflows, and constraints described against its **general knowledge** of software development and its **own typical capabilities**, paying attention to technology specifics mentioned in Part 2.
        3.  If this brief review reveals a **potential significant mismatch** or **obvious area for improvement** in *either Part 1 or Part 2* (e.g., "P4 granularity seems too strict given my current abilities," or "Part 2 / Constraint 2 specifies library X v1.0, but v3.0 is now standard and recommended for security"), the LLM **must**:
            *   **Concisely state** the potential issue and the specific guideline/constraint involved (e.g., "Guideline Check Suggestion (P8.1): Part 2 / Constraint X uses pattern Y, which is generally discouraged now in [Language/Framework]. Consider updating?").
            *   **Phrase it as a question or suggestion** for the user to consider, explicitly referencing this rule (P8.1).
            *   **Do not halt work.** Proceed with the user's primary request after raising the point(s).
            *   This check should be **brief and focused** on high-probability mismatches based on the LLM's internal knowledge. Avoid generic suggestions.
        4.  If no specific, significant potential issues are identified during the brief check, **do not comment** on the guideline review; simply proceed with the user's request.

2.  **Identify and Address Guideline Conflicts**
    *   **Reason:** To resolve discrepancies when user instructions contradict established guidelines (**Global Principles or Project-Specific Constraints**), ensuring consistent application or conscious deviation.
    *   **Context:** When a user statement or request directly conflicts with a specific rule in Part 1 or a constraint in Part 2.
    *   **Action:** LLM **must**:
        1.  **Identify:** Point out the conflict clearly, referencing the specific rule or constraint. (e.g., "You asked to use library Z, but Part 2 / Constraint 2 currently forbids external libraries. How should we proceed?").
        2.  **Clarify:** Ask the user to confirm whether to follow the guideline/constraint or the new instruction for the current situation.
        3.  **(Optional but Recommended):** Ask if this conflict suggests the guideline or constraint itself needs a permanent update (leading to Rule P8.4).

3.  **Identify and Codify Repeated Suggestions/Preferences**
    *   **Reason:** To capture and formalize recurring user workflow preferences or interaction patterns not currently reflected in the guidelines.
    *   **Context:** When the user repeatedly suggests a workflow element, expresses a preference, or uses an interaction pattern not documented in the guidelines.
    *   **Action:** LLM **must**:
        1.  **Identify:** Recognize the recurring pattern or suggestion. (e.g., "I've noticed you often ask for [specific format/action Z]. This isn't explicitly covered in the guidelines.").
        2.  **Propose Codification:** Ask the user if this repeated behavior should be formally added to the guidelines. (e.g., "Should we add a rule about [Z] to make this standard practice?").

4.  **Propose and Apply Guideline Updates**
    *   **Reason:** To formally incorporate agreed-upon changes into the guidelines document, ensuring it remains the accurate source of truth.
    *   **Context:** Following clarification/confirmation from rules P8.1, P8.2, or P8.3 where a permanent change to the guidelines is desired by the user.
    *   **Action:**
        1.  Based on the user's confirmation, **propose specific changes** (text additions/modifications/deletions) to `CONTRIBUTING-LLM.md`.
        2.  Follow the standard "Discuss -> Confirm -> Generate" process (P1.1) for generating the updated section(s) of the guidelines document itself.

### P9: README Generation Requirement

1.  **Include Guideline Reference in README**
    *   **Reason:** Ensures project users and future LLMs are aware these collaboration guidelines exist and should be followed for consistency.
    *   **Context:** When generating or significantly updating a project's `README.md` file.
    *   **Action:** LLM **must** include a statement in the `README.md` (e.g., in a "Developer Notes" or "Contributing" section) advising that development involving LLM assistance should follow the rules outlined in `../CONTRIBUTING-LLM.md` (adjust the relative path from the README's location as needed) and instructing potential contributors/LLMs to request this file if it wasn't provided.

## Part 2: Project-Specific Guidelines (`vibe-player` Example - JavaScript)

*(The following rules supplement or override the Global Principles specifically for the `vibe-player` project, defined by its context. Note: This example uses JavaScript, even though global examples are Python-based, reflecting the specific project context. The structure here remains simpler as each Constraint is typically a single rule.)*

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
*   **Action:** LLM should generally avoid merging conceptually distinct modules into single large files or drastically increasing file complexity without prior discussion, even during refactoring (though P5.1 allows broader refactoring proposals). Maintain the modular structure where possible.

#### Constraint 7: Documentation Format (JSDoc/PyCharm)
*   **Reason:** Specifies documentation standard for consistency and IDE integration for *this specific JavaScript project*.
*   **Context:** Overrides/Specializes Global Principle P3.2 (Documentation Examples).
*   **Action:** For JavaScript code in *this project*, LLM **must** use JSDoc format compatible with PyCharm/WebStorm analysis, including `@param {type}`, `@returns {type}`, and descriptions.

<!-- /CONTRIBUTING-LLM.md -->
