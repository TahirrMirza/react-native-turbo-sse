# react-native-turbo-sse

[![npm version](https://img.shields.io/npm/v/react-native-turbo-sse.svg?style=flat-square)](https://www.npmjs.com/package/react-native-turbo-sse)
[![Platform](https://img.shields.io/badge/platform-iOS%20%7C%20Android-lightgrey.svg?style=flat-square)](https://github.com/TahirrMirza/react-native-turbo-sse)
[![New Architecture](https://img.shields.io/badge/New%20Architecture-required-blue.svg?style=flat-square)](https://reactnative.dev/docs/new-architecture-intro)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

A blazing fast, production-ready **Server-Sent Events (SSE)** and **EventSource** library for React Native, built specifically for the **New Architecture (Turbo Modules)** using Nitrogen and JSI.

## Table of Contents

- [Why not standard react-native-sse or fetch polyfills?](#-why-not-standard-react-native-sse-or-fetch-polyfills)
- [Features](#features)
- [Installation](#installation)
  - [For Expo Projects](#for-expo-projects)
  - [For Bare React Native CLI](#for-bare-react-native-cli)
- [Usage](#usage)
- [API Methods](#api-methods)
- [Best Practices for LLM Apps](#best-practices-for-llm-apps)

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

### The React Hook (Recommended)

The easiest way to consume a stream in your React components is to use the `useTurboSSE` hook. It automatically handles the connection lifecycle, parses the stream, and provides a simple state object.

```tsx
import { useTurboSSE, ReadyState } from 'react-native-turbo-sse';

export default function App() {
  const { data, status, error, connect, disconnect } = useTurboSSE('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_OPENAI_TOKEN',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4',
      stream: true,
      messages: [{ role: 'user', content: 'Tell me a story.' }],
    }),
    debug: true,
  });

  return (
    <View>
      <Text>Status: {status === ReadyState.OPEN ? 'Connected' : 'Disconnected'}</Text>
      <Button title="Connect" onPress={connect} />
      <Button title="Disconnect" onPress={disconnect} />
      {data && <Text>Last message: {data.data}</Text>}
    </View>
  );
}
```

### The Vanilla Class API

If you need more manual control or are working outside of React components, you can instantiate the `TurboEventSource` class directly. It mirrors the standard web `EventSource` API with support for multiple event listeners.

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
    debug: true, // Enable detailed console logs
    body: JSON.stringify({
      model: 'gpt-4',
      stream: true,
      messages: [{ role: 'user', content: 'Tell me a story.' }],
    }),
  }
);

// 2. Listen for the connection to open
source.addEventListener('open', () => {
  console.log('Stream connected!');
});

// 3. Listen for incoming messages
source.addEventListener('message', (event) => {
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
source.addEventListener('error', (error) => {
  console.error('Connection failed:', error.message);
});

// 5. Connect!
source.connect();

// 6. Disconnect when unmounting
// source.disconnect();
// source.removeEventListener('message', myListener);
```

---

## API Methods

The `TurboEventSource` class gives you full manual control over the stream:

- `connect()`: Opens the connection to the SSE endpoint.
- `disconnect()` / `close()`: Closes the active stream and cleans up native resources.
- `addEventListener(type, listener)`: Attach multiple listeners for `open`, `message`, or `error` events.
- `removeEventListener(type, listener)`: Remove a specific listener.
- `removeAllEventListeners()`: Removes all active event listeners.
- `connectTimeoutMs` (Optional Number): Milliseconds to wait to establish the native TCP connection (Android only).
- `readTimeoutMs` (Optional Number): Milliseconds to wait between incoming chunks before terminating a dead connection. On iOS, this also dictates the initial connection timeout.
- `debug` (Optional Boolean): Enables detailed console logs for debugging the stream lifecycle.

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

To ensure butter-smooth rendering for high-frequency firehose streams:

1. **Use React Native Reanimated**: For the ultimate performance, pass the incoming chunks directly into a Reanimated **Shared Value**. Because Reanimated executes directly on the UI thread synchronously, you bypass the React layout calculation bridge entirely!

Check out the `example/` folder in this repository for a complete implementation of bypassing React state to render streams natively on the UI thread.
