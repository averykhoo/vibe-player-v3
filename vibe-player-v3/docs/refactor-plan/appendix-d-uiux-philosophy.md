# Appendix D: UI/UX Design Philosophy

This appendix restores the explicit UI/UX philosophy that underpins the component design choices.

## D.1. Core Principle: Clarity, Functionality, and Clean Design

* **Description:** The user interface design **must** prioritize clarity, information density, and functional utility
  above all else. The goal is to create a powerful tool for analysis, not a purely aesthetic piece. A clean,
  well-organized interface that provides clear feedback and powerful, predictable controls is paramount.
* **Implication for Component Development:**
    * **Simplicity:** Developers should produce simple, functional Svelte components that render standard, accessible
      HTML elements.
    * **Avoid Abstraction for Core Controls:** For core interactive elements like sliders and buttons, developers **must
      ** build custom Svelte components that directly wrap `<input type="range">` and `<button>` elements. This avoids
      using complex third-party UI libraries for these critical parts, ensuring:
        1. **Full Control:** We have complete control over the component's DOM structure, styling, and event handling.
        2. **Testability:** E2E tests using Playwright can reliably interact with standard HTML elements without
           fighting against a library's custom DOM manipulation.
    * **Information Density:** The UI should present relevant information (e.g., current time, parameter values,
      analysis results) in a way that is easy to scan and understand at a glance.