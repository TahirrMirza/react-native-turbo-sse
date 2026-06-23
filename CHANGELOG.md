# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-06-18

### Added

- `useFastSSE` React hook for easy stream consumption and lifecycle management.
- `ReadyState` enum exported for strict type checking of connection states.
- `.addEventListener`, `.removeEventListener`, and `.removeAllEventListeners` API to `TurboEventSource` supporting multiple listeners per stream.
- `debug?: boolean` flag in `FastSSEOptions` to toggle verbose console logging.

### Fixed

- **Critical:** Shared singleton bug where multiple `TurboEventSource` instances overwrote the same native connection callbacks.
- **Android:** Resolved OkHttpClient resource leak by caching the client builder, only rebuilding if timeouts change.
- **Android:** Cancels any active connection correctly when `.connect()` is called consecutively without disconnecting.
- **iOS:** Fixed `connectTimeoutMs` parameter being silently ignored. It now properly applies to `timeoutIntervalForRequest`.
- **iOS & Android:** Fixed bug where HTTP body was only sent for `POST` requests. Body is now correctly sent for `PUT`, `PATCH`, and `DELETE` requests as well.
- Replaced 8 hardcoded development `console.log` and `console.error` calls with the `debug` toggle.
