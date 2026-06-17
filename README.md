# react-native-turbo-sse

[![npm version](https://img.shields.io/npm/v/react-native-turbo-sse.svg?style=flat-square)](https://www.npmjs.com/package/react-native-turbo-sse)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

A blazing fast, production-ready **Server-Sent Events (SSE)** and **EventSource** library for React Native, built specifically for the **New Architecture (Turbo Modules)** using Nitrogen and JSI.

### 🛑 Why not standard react-native-sse or fetch polyfills?

Traditional React Native SSE libraries run entirely in JavaScript and wrap `XMLHttpRequest`. This causes the native network layer to buffer incoming chunks. If you are building an AI chat interface (OpenAI, Anthropic, Gemini), tokens will arrive in delayed, massive chunks instead of a smooth, typing effect.

`react-native-turbo-sse` uses Nitro Modules and JSI to pipe raw native bytecode (`OkHttp` on Android / `NSURLSession` on iOS) directly to the JavaScript runtime with **zero buffering and sub-millisecond latency**.

## Features

- 🚀 **Turbo Modules & JSI**: Bypasses the old React Native bridge. Tokens are sent from native C++/Swift/Kotlin to JS instantly.
- ⚡ **Zero-Buffering**: Built on iOS `URLSessionDataDelegate` and Android `OkHttp` to ensure chunks are delivered exactly as they arrive over the network.
- 🤖 **Perfect for LLMs**: Handles sub-millisecond firehose streaming (token-by-token) without dropping frames, with explicit manual control over reconnections to prevent server context loss.
- 📱 **Background Streams**: Configured to allow streams to survive when the app is backgrounded.
- 🛠️ **Expo Support**: Ships with a fully configured Expo Config Plugin for seamless integration.
- 📦 **New Architecture Ready**: Fully compatible with React Native 0.74+ and Fabric.

---

## Installation

### For Expo Projects

If you are using Expo, install the package and its native dependencies:

```bash
npx expo install react-native-turbo-sse react-native-nitro-modules
```

Since this library uses native code, you will need to prebuild your app or run it in an Expo Development Client:

```bash
npx expo prebuild
npx expo run:ios
# or
npx expo run:android
```

_(Note: The Expo config plugin handles all iOS background modes, New Architecture flags, and Android networking configurations automatically!)_

### For Bare React Native CLI

```bash
yarn add react-native-turbo-sse react-native-nitro-modules
```

Install the iOS Pods:

```bash
cd ios && pod install
```

---

## Usage

The library provides a standard `TurboEventSource` class that mirrors the web's `EventSource` API, but with support for custom headers and HTTP methods (perfect for authenticated POST requests to OpenAI!).

```typescript
import { TurboEventSource } from 'react-native-turbo-sse';

// 1. Create a new connection
const source = new TurboEventSource(
  'https://api.openai.com/v1/chat/completions',
  {
    method: 'POST', // Defaults to GET
    headers: {
      'Authorization': 'Bearer YOUR_OPENAI_TOKEN',
      'Content-Type': 'application/json',
    },
    // Optional Native Timeout Configurations
    connectTimeoutMs: 15000, // 15 seconds
    readTimeoutMs: 30000, // 30 seconds
    body: JSON.stringify({
      model: 'gpt-4',
      stream: true,
      messages: [{ role: 'user', content: 'Tell me a story.' }],
    }),
  }
);

// 2. Listen for the connection to open
source.onOpen(() => {
  console.log('Stream connected!');
});

// 3. Listen for incoming messages
source.onMessage((event) => {
  // Catch the end of the stream
  if (event.data === '[DONE]') {
    source.disconnect();
    return;
  }

  // Parse the token
  const payload = JSON.parse(event.data);
  const token = payload.choices[0].delta.content;
  console.log('Received token:', token);
});

// 4. Handle native or HTTP errors
source.onError((error) => {
  console.error('Connection failed:', error.message);
});

// 5. Connect!
source.connect();

// 6. Disconnect when unmounting
// source.disconnect();
```

---

## API Methods

The `TurboEventSource` class gives you full manual control over the stream:

- `connect()`: Opens the connection to the SSE endpoint.
- `disconnect()` / `close()`: Closes the active stream and cleans up native resources.
- `connectTimeoutMs` (Optional Number): Milliseconds to wait to establish the native TCP connection (Android only).
- `readTimeoutMs` (Optional Number): Milliseconds to wait between incoming chunks before terminating a dead connection. On iOS, this also dictates the initial connection timeout.
- `onOpen(callback)`: Fires when the connection successfully opens.
- `onMessage(callback)`: Fires for every parsed incoming chunk.
- `onError(callback)`: Fires on connection drops, network errors, or HTTP failures.

_Note: We intentionally do not auto-reconnect failed streams under the hood. For modern LLM streaming applications, automatically resuming a dropped connection with a `Last-Event-ID` often causes context loss on the server. You have full control to catch the error and reconnect if needed._

---

## Best Practices for LLM Apps

When building ChatGPT-like UIs, **never** append the entire chat history into a single `<Text>` component. React Native's Yoga layout engine will freeze trying to calculate line breaks for massive strings.

**Always use a `<FlatList>`** and render chunks or paragraphs individually:

```tsx
<FlatList
  data={messages}
  keyExtractor={(item, index) => index.toString()}
  renderItem={({ item }) => <Text>{item}</Text>}
/>
```

### Throttling & UI Thread Animations (Reanimated)

React Native's UI thread can freeze if you attempt to batch state updates too rapidly (e.g. updating React state every 1ms).

To ensure butter-smooth rendering:

1. **Throttle State Updates**: Buffer incoming chunks in a `useRef` and flush them to state using `setTimeout` at ~30 FPS (every 32ms).
2. **Use React Native Reanimated**: For the ultimate performance, pass the incoming chunks directly into a Reanimated **Shared Value**. Because Reanimated executes directly on the UI thread synchronously, you bypass the React layout calculation bridge entirely. This allows you to render sub-millisecond firehose tokens with flawlessly smooth scrolling!
