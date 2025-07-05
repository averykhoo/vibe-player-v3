# Chapter 5: The Development Workflow

## 5.1. Guiding Principles for Development

* **Storybook-First UI:** All Svelte UI components **must** be developed, documented, and visually verified in isolation
  within Storybook *before* being integrated into the main application.
* **Test-Driven Logic:** All core business logic within services will be developed using a strict TDD workflow with
  Vitest.
* **Behavior-Driven Features:** User-facing features will be defined by Gherkin scenarios and verified with Playwright
  E2E tests.
* **Dependency Injection for Testing:** All tests for UI components will inject mock services via Svelte's Context API,
  ensuring tests are fast and reliable.
* **Formal Command & Event Naming:** Adhere to a formal distinction between **Commands** (user-initiated actions telling
  the app to do something, e.g., `audioEngine.play()`) and **Events** (system notifications that something has happened,
  e.g., a worker message).
* **Rationale for the Modern Workflow:** This parallel "Component-First + Logic-First" workflow is an intentional
  evolution for a modern reactive stack. It de-risks the UI and business logic simultaneously in their respective ideal
  testing environments (Storybook and Vitest), leading to faster and more reliable final integration.

## 5.2. Project Setup & Initial Configuration

1. **Initialize SvelteKit Project:** Use `npm create svelte@latest vibe-player-v3`.
2. **Copy Configurations:** Copy `package.json` (for dependencies), `vite.config.ts`, `svelte.config.js`, and
   `tsconfig.json` from the `v2.3` reference project. Run `npm install`.
3. **Configure Storybook:** Run `npx storybook@latest init`. Configure it to work with the Svelte Context API for
   providing mock services in stories.
4. **Create Directory Structure:** Manually create the `services`, `stores`, `workers`, `types`, and `config` folders
   inside `src/lib`.

## 5.3. The Core Development Loop (Iterative Process)

1. **Task & Gherkin Review:** Review the relevant `.feature` file that defines the user-facing behavior.
2. **UI Component Dev (Storybook):** Create/update the `.svelte` component and its `.stories.ts` file. Build it in
   isolation, creating stories for all its visual states (disabled, loading, etc.). Use the Context API to provide mock
   services and data.
3. **Core Logic Dev (Vitest):** Create/update the `.test.ts` file for the relevant service. Write a failing test.
   Implement the pure TypeScript logic in the service until the test passes.
4. **Application Integration:** In the main application (`+page.svelte`), provide the real service instances via
   `setContext`. Use the verified Svelte component from Storybook. Wire up its events to the `appEmitter`.
5. **E2E Verification (Playwright):** Write or update the Playwright E2E tests to automate the Gherkin scenario.