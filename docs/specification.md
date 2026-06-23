# react-native-fast-sse — Project Specification

> **Status:** Active — in planning  
> **Source:** Converted from `react-native-fast-sse-specification.pdf`  
> **Last updated:** 2026-06-17

---

## Table of Contents

1. [Executive Summary & Problem Statement](#1-executive-summary--problem-statement)
2. [Architectural Comparison](#2-architectural-comparison)
3. [Technical Implementation Specification](#3-technical-implementation-specification)
   - [Android — Kotlin & OkHttp](#a-android-native-layer-kotlin--okhttp)
   - [iOS — Swift & NSURLSession](#b-ios-native-layer-swift--nsurlsession)
4. [JavaScript / TypeScript API Architecture](#4-javascript--typescript-api-architecture)
5. [Expo Support (Config Plugin)](#5-expo-support-config-plugin)
6. [Implementation Order for AI Agent / Engineer](#6-implementation-order-for-ai-agent--engineer)
7. [Improvements & Open Questions](#7-improvements--open-questions)

---

## 1. Executive Summary & Problem Statement

Current market solutions for SSE in React Native (e.g. `react-native-sse`) are written **entirely in JavaScript**. They polyfill the `EventSource` API by wrapping React Native's built-in `XMLHttpRequest` (XHR).

### Why JS/XHR-based SSE fails

- **Bridge buffering:** Standard XHR requests pass through the asynchronous React Native network bridge. The native OS layer aggressively **buffers** incoming data streams, meaning text arrives in large, unpredictable blocks instead of smooth token-by-token chunks required for LLM streaming UIs.
- **Background drops:** These connections frequently drop when the app enters a background state because the JS runtime pauses.
- **Latency:** Every event roundtrips through JSON serialization on the async bridge.

### The Solution

`react-native-fast-sse` delegates connection management **entirely to native networking frameworks** (OkHttp on Android, NSURLSession on iOS), pumping data fragments **synchronously** into the JavaScript runtime via **C++ JSI hooks** (exposed through [NitroModules](https://github.com/mrousavy/nitro)), guaranteeing:

- **Zero-buffer** event delivery
- **Sub-millisecond** dispatch latency
- **OS-managed connection lifecycle** that survives JS thread pauses

---

## 2. Architectural Comparison

| Feature | Traditional JS-Polyfill (XHR) | NitroModule + JSI (This Package) |
|---|---|---|
| **Networking Layer** | JS-wrapped XHR Polyfill | Native OS Core (OkHttp / NSURLSession) |
| **Data Transfer Method** | Async JSON Bridge Serialization | Synchronous Memory Invocations via JSI (C++) |
| **Buffering Behavior** | High — aggregated bulk chunks | **Zero** — instantaneous token streaming |
| **Background Performance** | Instantly killed when JS thread pauses | Maintained by OS-level connection lifecycle |
| **Event Dispatch** | `DeviceEventEmitter` (async, slow) | Direct JSI callback invocation (sync, fast) |

---

## 3. Technical Implementation Specification

### A. Android Native Layer (Kotlin & OkHttp)

Use OkHttp's **official `okhttp-sse` extension library**. Do **not** manually split HTTP chunks from raw streams — the SSE extension handles framing correctly.

#### Gradle Dependencies

```kotlin
// android/build.gradle
dependencies {
    implementation "com.squareup.okhttp3:okhttp:4.12.0"
    implementation "com.squareup.okhttp3:okhttp-sse:4.12.0"
}
```

#### EventSourceListener Implementation

Implement the `EventSourceListener` interface to handle all SSE lifecycle events natively:

```kotlin
class FastSseListener(private val jsCallback: (type: String, id: String?, data: String) -> Unit)
    : EventSourceListener() {

    override fun onOpen(eventSource: EventSource, response: Response) {
        jsCallback("open", null, "")
    }

    override fun onEvent(
        eventSource: EventSource,
        id: String?,
        type: String?,
        data: String
    ) {
        // Synchronously forward data over C++ JSI context directly to JS
        // Trim \r\n to conform with SSE spec before forwarding
        jsCallback(type ?: "message", id, data.trimEnd('\r', '\n'))
    }

    override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
        jsCallback("error", null, t?.message ?: "Unknown error")
    }

    override fun onClosed(eventSource: EventSource) {
        jsCallback("close", null, "")
    }
}
```

> **Note:** The callback lambda here maps to a NitroModules JSI `std::function` bridge — see Section 5 for the exact Nitro schema definition.

---

### B. iOS Native Layer (Swift & NSURLSession)

Use `NSURLSessionDataDelegate` with streaming data tasks. To **explicitly prevent network chunk aggregation**, data must be processed as soon as byte arrays arrive rather than being buffered by the URL loading system.

#### Session Configuration

```swift
let config = URLSessionConfiguration.default
config.timeoutIntervalForRequest = .infinity   // Never timeout on idle SSE stream
config.timeoutIntervalForResource = .infinity
let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
```

#### Delegate Implementation

```swift
extension FastSse: URLSessionDataDelegate {

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive data: Data
    ) {
        guard let rawString = String(data: data, encoding: .utf8) else { return }

        // Parse SSE protocol markers: "id:", "event:", "data:"
        // Trim \r\n to conform with SSE spec
        let trimmed = rawString.trimmingCharacters(in: .newlines)
        parseSSEChunk(trimmed)   // → calls JSI runtime function hook
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        if let error = error {
            onErrorCallback?(error)
        } else {
            onCloseCallback?()
        }
    }
}
```

#### SSE Chunk Parser (Swift)

```swift
private func parseSSEChunk(_ chunk: String) {
    var eventType = "message"
    var eventId: String? = nil
    var dataLines: [String] = []

    for line in chunk.components(separatedBy: "\n") {
        if line.hasPrefix("event:") {
            eventType = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces)
        } else if line.hasPrefix("id:") {
            eventId = String(line.dropFirst(3)).trimmingCharacters(in: .whitespaces)
        } else if line.hasPrefix("data:") {
            dataLines.append(String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces))
        }
    }

    if !dataLines.isEmpty {
        let joined = dataLines.joined(separator: "\n")
        onMessageCallback?(eventType, eventId, joined)
    }
}
```

---

## 4. JavaScript / TypeScript API Architecture

The public API must emulate the **browser `EventSource` specification** while adding strict TypeScript typing for AI/LLM token payloads.

### Types

```typescript
export interface SSEEvent {
  id?: string;
  event?: string;  // custom event type, defaults to "message"
  data: string;
}

export interface FastSSEOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;                       // required for POST (e.g. OpenAI chat/completions)
  withCredentials?: boolean;           // future: cookie-based auth
}
```

### Core Class

```typescript
export class TurboEventSource {
  constructor(url: string, options?: FastSSEOptions);

  onOpen(callback: () => void): void;
  onMessage(callback: (event: SSEEvent) => void): void;
  onError(callback: (error: Error) => void): void;
  close(): void;

  readonly readyState: 0 | 1 | 2; // CONNECTING | OPEN | CLOSED
}
```

### NitroModules Nitro Schema (`src/FastSse.nitro.ts`)

```typescript
import type { HybridObject } from 'react-native-nitro-modules';

export interface FastSse extends HybridObject<{
  ios: 'swift';
  android: 'kotlin';
}> {
  // Start an SSE connection
  connect(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: string,
    onOpen: () => void,
    onMessage: (event: string, id: string, data: string) => void,
    onError: (message: string) => void,
    onClose: () => void
  ): void;

  // Terminate the connection
  disconnect(): void;

  // Current connection state: 0=CONNECTING, 1=OPEN, 2=CLOSED
  readonly readyState: number;
}
```

---

## 5. Expo Support (Config Plugin)

> **Decision:** ✅ Expo support is confirmed and will ship as part of v1.0.

### Why a Config Plugin is Needed

`react-native-fast-sse` is a native module — it requires modifications to the host app's native project that Expo Managed Workflow cannot perform automatically. Without a config plugin, Expo users must:

- Manually run `npx expo prebuild` and edit `Info.plist` (iOS background modes)
- Manually confirm New Architecture is enabled

The config plugin eliminates all of this via `npx expo prebuild`.

### What the Plugin Must Do

| Platform | Modification | Reason |
|---|---|---|
| **iOS** | Add `UIBackgroundModes: ["fetch"]` to `Info.plist` | Required for NSURLSession to maintain connections when the app is backgrounded |
| **iOS** | Ensure `IPHONEOS_DEPLOYMENT_TARGET >= 15.1` in Podfile | NitroModules minimum requirement |
| **Android** | Ensure `newArchEnabled=true` in `gradle.properties` | NitroModules requires New Architecture |
| **Android** | Ensure `minSdkVersion >= 24` in `build.gradle` | OkHttp SSE extension requirement |

### Plugin File Structure

```
react-native-fast-sse/
├── plugin/
│   ├── src/
│   │   ├── index.ts          ← main plugin entry (TypeScript source)
│   │   ├── withIos.ts        ← iOS-specific mods
│   │   └── withAndroid.ts    ← Android-specific mods
│   └── build/
│       └── index.js          ← compiled output (published to npm)
└── package.json              ← "main" points to plugin/build/index.js for plugin field
```

### Plugin Source (`plugin/src/index.ts`)

```typescript
import { ConfigPlugin, withPlugins } from '@expo/config-plugins';
import { withFastSseIos } from './withIos';
import { withFastSseAndroid } from './withAndroid';

const withFastSse: ConfigPlugin = (config) => {
  return withPlugins(config, [
    withFastSseIos,
    withFastSseAndroid,
  ]);
};

export default withFastSse;
```

### iOS Plugin (`plugin/src/withIos.ts`)

```typescript
import { ConfigPlugin, withInfoPlist, withPodfileProperties } from '@expo/config-plugins';

export const withFastSseIos: ConfigPlugin = (config) => {
  // 1. Add UIBackgroundModes: fetch for NSURLSession background streaming
  config = withInfoPlist(config, (c) => {
    if (!c.modResults.UIBackgroundModes) {
      c.modResults.UIBackgroundModes = [];
    }
    if (!c.modResults.UIBackgroundModes.includes('fetch')) {
      c.modResults.UIBackgroundModes.push('fetch');
    }
    return c;
  });

  // 2. Enforce minimum deployment target for NitroModules
  config = withPodfileProperties(config, (c) => {
    const current = parseFloat(c.modResults['ios.deploymentTarget'] ?? '0');
    if (current < 15.1) {
      c.modResults['ios.deploymentTarget'] = '15.1';
    }
    return c;
  });

  return config;
};
```

### Android Plugin (`plugin/src/withAndroid.ts`)

```typescript
import { ConfigPlugin, withGradleProperties } from '@expo/config-plugins';

export const withFastSseAndroid: ConfigPlugin = (config) => {
  // Ensure New Architecture is enabled (required for NitroModules)
  return withGradleProperties(config, (c) => {
    const props = c.modResults;
    const existing = props.find(
      (p) => p.type === 'property' && p.key === 'newArchEnabled'
    );
    if (!existing) {
      props.push({ type: 'property', key: 'newArchEnabled', value: 'true' });
    } else {
      (existing as any).value = 'true';
    }
    return c;
  });
};
```

### Expo User Setup

After the plugin is published, Expo users simply:

```bash
# Install the package
npx expo install react-native-fast-sse react-native-nitro-modules
```

```json
// app.json
{
  "expo": {
    "plugins": ["react-native-fast-sse"]
  }
}
```

```bash
# Rebuild the native project
npx expo prebuild --clean
npx expo run:ios   # or run:android
```

> **Note:** Expo Go is **not** supported. A development build is required because NitroModules compile native C++ code that cannot be loaded into Expo Go's generic sandbox.

### `package.json` Changes for Plugin

```json
{
  "main": "./lib/module/index.js",
  "expo": {
    "plugin": "./plugin/build/index.js"
  },
  "files": [
    "src", "lib", "android", "ios", "cpp", "nitrogen",
    "nitro.json", "*.podspec",
    "plugin/build",       ← add this
    "react-native.config.js"
  ]
}
```

---

## 6. Implementation Order for AI Agent / Engineer

Execute in this exact order to avoid circular dependencies:

| Step | Task | Notes |
|---|---|---|
| **1** | **Nitro Schema Definition** | Define `FastSse.nitro.ts` with the full method surface (see Section 4). Run `npx nitro-codegen` to generate C++ host objects. |
| **2** | **C++ JSI Registration** | The generated `HybridFastSseSpec` C++ class binds native callbacks to JS functions without going through `RCTDeviceEventEmitter`. No manual JSI setup needed — Nitro handles registration. |
| **3** | **Android Kotlin Implementation** | Implement `FastSse.kt` extending `HybridFastSseSpec`. Wire `EventSourceListener` callbacks to the JSI `std::function` parameters received from JS. |
| **4** | **iOS Swift Implementation** | Implement `FastSse.swift` extending `HybridFastSseSpec`. Wire `URLSessionDataDelegate` callbacks to JSI function parameters. |
| **5** | **Payload Trimming** | Ensure native string streams trim `\r\n` **before** piping into the runtime to conform with the [SSE specification (WHATWG)](https://html.spec.whatwg.org/multipage/server-sent-events.html). |
| **6** | **JS Wrapper Class** | Build the `TurboEventSource` class (Section 4) that wraps the raw Nitro hybrid object with a clean EventSource-like API. |
| **7** | **TypeScript Exports** | Update `src/index.tsx` to export `TurboEventSource`, `FastSSEOptions`, `SSEEvent`. |
| **8** | **Expo Config Plugin** | Build plugin under `plugin/src/`, compile to `plugin/build/`, wire into `package.json` `expo.plugin` field. |
| **9** | **Example App** | Wire up a demo in `example/` that streams from an OpenAI-compatible endpoint and renders tokens in real-time. |

---

## 7. Improvements & Open Questions

> This section captures improvements beyond the original PDF spec. Review and update as decisions are made.

### ✅ Confirmed Improvements Over the Original Spec

| Area | Original Spec | Recommended Improvement |
|---|---|---|
| **Native Module System** | Raw TurboModules / manual JSI | **NitroModules** (already scaffolded) — auto-generates C++ boilerplate, type-safe callbacks, no manual JSI registration |
| **Android SSE Parsing** | Not explicitly covered | Use OkHttp `okhttp-sse` — already handles SSE framing, retry logic, and reconnection per spec |
| **iOS Chunk Parsing** | Left as "parse markers" | Provide a proper multi-line `data:` accumulator that joins lines with `\n` per SSE spec |
| **`readyState`** | Not in original spec | Expose `readyState: 0 | 1 | 2` mirroring browser `EventSource` for easy drop-in replacement |
| **Custom `event:` type** | Only `id` + `data` in callback | Include `event` field in `SSEEvent` — required for OpenAI's `done` / `error` event types |
| **POST support** | Mentioned but no body forwarding | Explicitly pass `body` through Nitro schema; required for OpenAI `chat/completions` |
| **Background persistence** | Mentioned at high level | iOS: use `URLSessionConfiguration.background` configuration for true background streaming |

### ❓ Open Questions

- [ ] **Reconnection logic:** Should the native layer handle automatic reconnection with the `retry:` field from SSE spec, or leave it to the JS wrapper?
- [ ] **Request cancellation:** When `disconnect()` is called mid-stream, how should in-flight callbacks be guarded? (Kotlin `EventSource.cancel()` is async.)
- [ ] **Multiple simultaneous connections:** Should the Nitro hybrid object represent a single connection (one instance per connection) or manage a connection pool?
- [ ] **`last-event-id` header:** Should the native layer automatically send the `Last-Event-ID` header on reconnect per SSE spec?
- [ ] **Error retry codes:** Which HTTP status codes should trigger reconnection vs. hard failure?
- [x] **Expo compatibility:** ✅ Decided — ship a config plugin. See Section 5.

### 🏗 Architecture Note: Why NitroModules Over Raw TurboModules

The original spec describes manually wiring JSI C++ hooks. The scaffold already uses [NitroModules](https://github.com/mrousavy/nitro) (`react-native-nitro-modules`), which is a **superset** of this approach:

- Nitro auto-generates the C++ `HybridObject` host class from the TypeScript spec via `nitro-codegen`
- Callbacks defined as `std::function<void(...)>` in the generated C++ are zero-cost JSI function invocations — exactly what the spec calls for
- No manual `jsi::Runtime` access or `RCTDeviceEventEmitter` needed
- The `nitro.json` config drives autolinking for both platforms

This means Steps 1–2 of the implementation order above are handled almost entirely by running `npx nitro-codegen` after updating `FastSse.nitro.ts`.
