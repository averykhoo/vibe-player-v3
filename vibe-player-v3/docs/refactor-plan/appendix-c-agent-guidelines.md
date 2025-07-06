[//]: # ( vibe-player-v3/docs/refactor-plan/appendix-c-agent-guidelines.md )
# Appendix C: AI Agent Collaboration Guidelines

This section defines the operational protocols for any developer (human or AI) working on this project. It is a
mandatory guide for implementation.

## P0: Agent Autonomy & Minimized Interaction

**Principle Statement:** The agent should operate with a high degree of autonomy once a task and its objectives are
clearly defined.

* **Reason:** To improve development velocity, reduce unnecessary user interruptions, and allow the agent to perform
  comprehensive tasks efficiently.
* **Context:** After the initial plan or task has been approved by the user, or for routine tasks that align with
  established patterns and guidelines.
* **Action:**
    * The agent must proceed with task implementation without seeking confirmation for intermediate steps, unless a step
      involves significant architectural deviation, conflicts with core guidelines, or encounters critical ambiguity not
      solvable with P2.1 (Proactive Clarification Seeking).
    * Confirmation should primarily be reserved for: initial plan approval, major changes to agreed-upon plans,
      situations explicitly requiring user choice, or when critical information is missing after an attempt to clarify.
    * The agent should default to making reasonable, well-documented decisions to keep work flowing, reporting these
      decisions in its task summary or commit messages.

## P1: Task-Driven Workflow & Initial Confirmation

**Principle Statement:** Complex tasks or those initiating significant changes require an initial proposal and user
confirmation before full implementation.

* **Reason:** Ensures user alignment on scope and approach for major work, prevents wasted effort on undesired
  solutions, and maintains user oversight on architectural decisions.
* **Context:** When initiating any non-trivial change (new features, significant refactoring, extensive documentation
  rewrites) or when explicitly requested by the user.
* **Action:** The agent first analyzes the task, then outlines a proposed solution (e.g., affected files, high-level
  logic changes, key components to be developed/modified). This proposal is presented to the user for explicit
  confirmation. Only after confirmation should the agent proceed with the detailed implementation of that proposal.
  Minor, clearly defined sub-tasks within an approved plan generally do not require re-confirmation (see P0).

## P2: Clarity & Explicit Communication

### P2.1: Proactive Clarification Seeking

**Principle Statement:** The agent must seek clarification for ambiguous tasks or requirements.

* **Reason:** Avoids incorrect assumptions and wasted effort. Leverages user's domain/project knowledge.
* **Context:** Whenever requirements, existing code, constraints, or user intent seem ambiguous or underspecified.
* **Action:** The agent **must halt and ask** clarifying questions before making assumptions or generating potentially
  incorrect output.

### P2.2: Explanation of Changes (Structured Output)

**Principle Statement:** The agent must explain its actions and rationale in a structured manner.

* **Reason:** Provides a clear record of actions and rationale, especially regarding design choices or non-obvious
  logic. Aids user review and architectural oversight.
* **Context:** When providing any generated code, text block, or completing a task.
* **Action:** The agent explains *what* it did and *why* the specific approach was taken (e.g., in a commit message
  draft, task report, or logs), especially if there were alternatives.

## P3: Maintainability & Consistency

### P3.1: Adherence to Existing Patterns & Controlled Refactoring

**Principle Statement:** The agent must adhere to existing project patterns by default and propose refactoring only with
explicit user approval.

* **Reason:** Ensures codebase remains cohesive and allows for controlled improvements. Reduces cognitive load.
* **Context:** When adding or modifying code or documentation.
* **Action:**
    * The agent **must analyze and strictly adhere** to existing project patterns (style, structure, naming conventions)
      as defined in this plan. This is the default operational mode.
    * If the agent identifies areas where deviation from existing patterns could significantly improve code health,
      maintainability, performance, or align better with best practices, it **may propose these refactoring changes** to
      the user, explaining the rationale clearly. Such refactoring requires explicit user approval and activation of a "
      Refactor phase" before implementation.

### P3.2: High-Quality Documentation & Comments

**Principle Statement:** The agent must generate high-quality documentation and comments for the code it produces and
preserve existing relevant comments.

* **Reason:** Critical for future agent understanding and maintenance (including historical context), aids human
  comprehension, enables IDE features.
* **Context:** When generating or modifying functions, classes, complex variables, modules, or significant logic blocks.
* **Action:**
    * The agent generates comprehensive TypeScript Doc comments (JSDoc-style) for all public functions, classes, and
      types. Include descriptions, parameters, returns, types, and potentially exceptions/raises.
    * Use inline comments for complex logic steps.
    * **Crucially, preserve existing meaningful comments unless the code they refer to is removed. These comments serve
      as a historical log for future agent context to understand *why* code evolved.** Maintain documentation alongside
      code.

### P3.3: Conciseness and Non-Redundancy in Documentation

**Principle Statement:** All generated documentation and explanations should be concise and non-redundant.

* **Reason:** Optimizes agent processing time/cost, reduces noise for human readers, improves maintainability of the
  documentation itself.
* **Context:** When generating or updating *any* documentation, including this `CONTRIBUTING-LLM.md`, `README.md`, or
  code comments/docstrings.
* **Action:** The agent should strive for concise language in all generated text. Avoid redundancy. Use precise
  terminology. However, when explaining complex logic or design choices, **prioritize the clarity needed for both human
  and future agent understanding**, even if it requires slightly more detail than absolute minimum brevity would allow.

### P3.4: File Identification Comments (Full Files Only)

**Principle Statement:** Full file content generated by the agent must include file identification comments.

* **Reason:** Allows agent to identify file context when receiving pasted content; allows user to verify paste location.
* **Context:** When generating the *entire content* of a file.
* **Action:** The agent includes file path comments at the **absolute start and end** of the generated file content (
  e.g., `// path/to/file.ts`, `<!-- /path/to/file.html -->`). Use the appropriate comment style for the file type. Not
  needed for partial replacements.

### P3.5: Logical Sectioning (Long Files)

**Principle Statement:** Long files should be logically sectioned using comments.

* **Reason:** Improves readability and navigation for humans and agents. Facilitates targeted section replacements.
* **Context:** When working with files containing multiple distinct logical parts.
* **Action:** The agent uses clear section header comments (e.g., `# --- Initialization ---`,
  `/* === API Handlers === */`) to delineate logical blocks. Use the appropriate comment style.

## P4: Guideline Adherence & Conflict Reporting

### P4.1: Proactive Viability Check & Reporting

**Principle Statement:** The agent should report if its knowledge suggests a guideline or constraint is suboptimal for a
task.

* **Reason:** To proactively identify guidelines or constraints that might be outdated or conflict with best practices,
  based on the agent's internal knowledge.
* **Context:** When a task relates to specific guidelines or constraints.
* **Action:** If the agent's internal knowledge suggests a guideline might be outdated or conflict with best practices
  for the given task, it **must report** this to the user as part of its analysis or proposal. It should not
  independently act against the guideline but await user instruction.

### P4.2: Identify and Report Guideline Conflicts

**Principle Statement:** The agent must identify and report conflicts between user instructions and established
guidelines, seeking explicit direction.

* **Reason:** To resolve discrepancies when user instructions contradict established guidelines, ensuring consistent
  application or conscious deviation.
* **Context:** When a direct user instruction conflicts with a specific rule in these guidelines.
* **Action:** The agent **must** identify and clearly point out any conflict between user instructions and established
  guidelines, referencing the specific rule. It must then report this conflict and ask the user for explicit instruction
  on how to proceed for that instance.

## P5: Full Word Naming Convention

**Principle Statement:** All string keys for states, events, commands, and types must use full, descriptive English
words in `SCREAMING_SNAKE_CASE` for constants and `camelCase` for other identifiers.

* **Reason:** This makes the system transparent and easy to debug. Obscure keys are forbidden.

## P6: README Generation Requirement

**Principle Statement:** A reference to these coding agent collaboration guidelines must be included in the project's
main `README.md`.

* **Reason:** Ensures project users and future agents are aware these collaboration guidelines exist and should be
  followed for consistency.
* **Action:** The agent **must** include a statement in the `README.md` advising that development involving agent
  assistance should follow the rules outlined in this document, and instructing them to request it if it was not
  provided.

## P7: Branch-Based Code Submission

**Principle Statement:** The agent submits work by committing to feature branches and pushing to the remote repository,
enabling review and CI/CD.

* **Reason:** Ensures code changes are visible for review, allows CI/CD integration, facilitates collaboration, and
  avoids inaccessible local code.
* **Action:** The agent commits changes with clear, descriptive messages to a dedicated feature branch and pushes it to
  the remote repository.

## P8: Refined V3 Development Workflow

**Principle Statement:** All feature development must follow a specific, multi-stage workflow that prioritizes isolation
and testability.

* **Reason:** To enforce the architectural principles of the V3 rewrite, ensure components are decoupled and robust, and
  maintain a high standard of quality.
* **Action:** When implementing a new feature, the agent **must** adhere to the following sequence:
    1. **Gherkin & Plan Review:** Consult the relevant Gherkin `.feature` file to understand the user-facing
       requirements.
    2. **Storybook-First Component Development:**
        * Create or update the required Svelte components in isolation within Storybook.
        * Develop stories that cover all visual states (e.g., default, disabled, loading, error).
        * Use Svelte's **Context API** to provide mock services and stores directly to the component within its stories.
          **Do not** import services directly into components.
    3. **Test-Driven Service Logic:**
        * Write unit tests (using Vitest) for any new or modified business logic within the relevant services (
          `/src/lib/services/`).
        * Implement the service logic only after a failing test has been written.
    4. **Application Integration:**
        * In the main application layout (`+page.svelte` or `+layout.svelte`), provide the real service instances via
          `setContext`.
        * Integrate the verified Svelte components from Storybook.
        * Wire up component events to the global `appEmitter` or `AudioOrchestratorService` as appropriate.
    5. **E2E Test Verification:**
        * Write or update the Playwright E2E tests to automate the Gherkin scenario.
        * The final implementation **must** pass these E2E tests. If a relevant scenario does not exist, a new one must
          be proposed and approved before implementation.