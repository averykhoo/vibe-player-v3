[//]: # ( vibe-player-v3/docs/refactor-plan/chapter-6-qa-and-testing.md )
# Chapter 6: Quality Assurance & Testing Strategy

## 6.1. The Testing Pyramid Layers

| Layer                       | Tool(s)                          | Purpose                                                                        | Run on PR? | Is Fast? |
|:----------------------------|:---------------------------------|:-------------------------------------------------------------------------------|:----------:|:--------:|
| **Static Analysis**         | ESLint, Svelte-Check, TypeScript | Enforce type safety, code quality, style, and architectural rules.             |    Yes     | Blazing  |
| **Component Testing**       | Storybook, Vitest, Testing Lib   | Visually inspect and unit test every component in complete isolation.          |    Yes     |   Fast   |
| **Unit Tests**              | Vitest                           | Test individual functions/methods in isolation (includes V1 Characterization). |    Yes     |   Fast   |
| **Integration Tests**       | Vitest                           | Test collaboration between services via the event emitter.                     |    Yes     |   Fast   |
| **End-to-End (E2E) Tests**  | Playwright                       | Verify complete user flows defined in Gherkin scenarios.                       |    Yes     |   Slow   |
| **Visual Regression Tests** | Playwright (`toHaveScreenshot`)  | Prevent unintended visual bugs in UI and canvases in CI.                       |  Optional  |   Slow   |
| **CI Static Analysis**      | GitHub CodeQL, SonarCloud        | Deep security, tech debt, and maintainability scans.                           |    Yes     |  Medium  |

## 6.2. Local Development Checks (The Inner Loop)

* **Type Safety (`svelte-check`):** Enforces strict typing for all `.ts` and `.svelte` files.
* **Code Quality & Formatting (ESLint & Prettier):** Enforces best practices and consistent code style.
* **Architectural Rules (ESLint):** This is **critical** for maintaining the Hexagonal Architecture. ESLint, with the
  `eslint-plugin-import` package, **must** be configured to enforce strict architectural boundaries. This check prevents
  architectural decay over time and is a mandatory quality gate. The rules must enforce:
    * UI Components (`src/lib/components/`) **must not** directly import from other technology-specific adapters (e.g.,
      a UI component cannot import a Web Worker module).
    * Core Services (`src/lib/services/`) **must not** import from UI Components (`src/lib/components/`) or page
      routes (`src/routes/`).
    * Services can only depend on other services, stores, types, and their own adapters.
* **Traceability for Debugging:** All logical operations must be traceable via a `traceId` passed through all events and
  service calls. This allows developers to easily filter logs and debug complex, asynchronous flows. **(See Appendix K
  for the full implementation contract).**

## 6.3. Automated Testing

* **Unit Tests & V1 Characterization Testing:** Pure logic from V1 is ported and tested against "golden master" JSON
  test vectors to prevent regressions.
* **Component Tests:** UI components will be rendered with mock services provided via the Context API. Tests will assert
  that components render correctly and dispatch the correct events on user interaction.
* **Integration Tests:** Verify collaboration between modules by mocking out the lowest-level dependencies.
* **End-to-End (E2E) Tests:** Simulated user journeys ensure the entire application functions correctly.