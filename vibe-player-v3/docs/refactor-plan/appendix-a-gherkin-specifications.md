# Appendix A: Gherkin Feature Specifications

This appendix contains the executable specifications that define the application's behavior. The developer **must**
ensure the implemented code passes Playwright E2E tests derived from these scenarios.

## Feature Files

The following Gherkin feature files define the expected behavior of the application:

- [File Loading](gherkin/file_loading.feature)
- [Playback Controls](gherkin/playback_controls.feature)
- [Parameter Adjustment](gherkin/parameter_adjustment.feature)
- [VAD Analysis](gherkin/vad_analysis.feature)
- [Tone Detection](gherkin/tone_analysis.feature)
- [URL State](gherkin/url_state.feature)

These feature files serve as both documentation and executable specifications. They are written in the Gherkin language, which uses a natural language syntax that can be understood by both technical and non-technical stakeholders.

Each feature file contains one or more scenarios that describe specific behaviors of the application. These scenarios follow the Given-When-Then pattern:

- **Given**: Sets up the initial context
- **When**: Describes an action or event
- **Then**: Describes the expected outcome

The Playwright E2E tests are derived from these scenarios and verify that the application behaves as expected.