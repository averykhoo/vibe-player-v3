<!-- /CONTRIBUTING-LLM.md -->
# LLM Assistant Collaboration Guidelines

This document outlines the principles and procedures for collaborating with an LLM assistant on software projects. Adherence to these guidelines ensures efficient, maintainable, and architecturally sound development, particularly suited for iterative or "vibe coding" workflows where clear communication and user oversight are paramount.

*(**Note on "Vibe Coding":** This term, popularized by Andrej Karpathy, refers to a development approach heavily reliant on LLMs, where the programmer guides the process with natural language descriptions, reviews/tests the generated code, and iterates, potentially without deep manual familiarity with every line written by the AI initially. These guidelines aim to make such collaboration effective and safe.)*

### P1: Iterative & Confirmative Workflow

1.  **Understand -> Discuss -> Confirm -> Generate Process**
    *   **Reason:** Ensures user control over design/architecture, prevents wasted generation cycles, maintains focus.
    *   **Context:** When initiating any non-trivial change (code or documentation).
    *   **Action:** LLM first states understanding, outlines proposed changes (logic/content points only) & implications -> Discuss approach with user -> **Explicitly ask for confirmation** -> Only then generate the specific code/text block.

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

### P4: Guideline Maintenance, Evolution & Viability

1.  **Proactive Viability Check during Guideline Updates**
    *   **Reason:** To proactively identify guidelines **(both Global Principles and Project-Specific Constraints)** that might be suboptimal or outdated due to advancements in LLM capabilities, changes in general or technology-specific best practices, or potential internal inconsistencies, ensuring the collaboration framework remains efficient and effective.
    *   **Context:** To be performed *whenever these guidelines (`CONTRIBUTING-LLM.md`) are being explicitly discussed or modified* (e.g., in response to P8.2, P8.3, or a direct user request to update them). Not performed on initial project load.
    *   **Action:**
        1.  When generating a proposed update for these guidelines, LLM performs a **brief internal review** of the *entire* guidelines document (**including both Part 1 and the applicable Part 2 section**) as part of formulating the update.
        2.  It compares the principles, workflows, and constraints described against its **general knowledge** of software development and its **own typical capabilities**, paying attention to technology specifics mentioned in Part 2.
        3.  If this review reveals a **potential significant mismatch** or **obvious area for improvement** *in addition to the specific change being requested* (e.g., "P4 granularity seems too strict given my current abilities," or "Part 2 / Constraint 2 specifies library X v1.0, but v3.0 is now standard and recommended for security"), the LLM **may optionally**:
            *   **Concisely state** the *additional* potential issue and the specific guideline/constraint involved (e.g., "Guideline Check Suggestion (P8.1): While updating P4, I also noticed Part 2 / Constraint X uses pattern Y, which is generally discouraged now in [Language/Framework]. Consider updating this too?").
            *   **Phrase it as a question or suggestion** for the user to consider, explicitly referencing this rule (P8.1).
            *   **Prioritize generating the user's requested update first.** The viability check suggestion should be secondary.
            *   This check should be **brief and focused** on high-probability mismatches based on the LLM's internal knowledge. Avoid generic suggestions.
        4.  If no *additional* specific, significant potential issues are identified during the review, **do not comment** on the guideline review; simply generate the requested update.

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
    *   **Context:** Following clarification/confirmation from rules P8.1, P8.2, or P8.3 where a permanent change to the guidelines is desired by the user, or when explicitly asked to update the guidelines.
    *   **Action:**
        1.  Based on the user's confirmation, **propose specific changes** (text additions/modifications/deletions) to `CONTRIBUTING-LLM.md`.
        2.  Follow the standard "Discuss -> Confirm -> Generate" process (P1.1) for generating the updated section(s) of the guidelines document itself.

### P6: README Generation Requirement

1.  **Include Guideline Reference in README**
    *   **Reason:** Ensures project users and future LLMs are aware these collaboration guidelines exist and should be followed for consistency.
    *   **Context:** When generating or significantly updating a project's `README.md` file.
    *   **Action:** LLM **must** include a statement in the `README.md` (e.g., in a "Developer Notes" or "Contributing" section) advising that development involving LLM assistance should follow the rules outlined in `../CONTRIBUTING-LLM.md` (adjust the relative path from the README's location as needed) and instructing potential contributors/LLMs to request this file if it wasn't provided.

<!-- /CONTRIBUTING-LLM.md -->
