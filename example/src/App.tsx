import { useState, useEffect } from 'react';
import {
  Text,
  View,
  StyleSheet,
  TextInput,
  Button,
  ScrollView,
  type TextInputProps,
} from 'react-native';
import { ReadyState, useFastSSE } from 'react-native-fast-sse';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  useAnimatedRef,
} from 'react-native-reanimated';

// Local test server endpoint
const defaultUrl = 'http://192.168.0.136:3000/stream';
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);
const AnimatedScrollView = Animated.createAnimatedComponent(ScrollView);

export default function App() {
  const [url, setUrl] = useState(defaultUrl);
  const textValue = useSharedValue('');
  const scrollViewRef = useAnimatedRef<ScrollView>();

  const animatedProps = useAnimatedProps<TextInputProps & { text?: string }>(
    () => {
      return { text: textValue.value };
    }
  );

  const { data, status, error, connect, disconnect } = useFastSSE(url, {
    method: 'GET',
    debug: true,
  });

  useEffect(() => {
    if (!data) return;

    if (data.data === '[DONE]') {
      disconnect();
      return;
    }

    let token = data.data;
    try {
      const payload = JSON.parse(data.data);
      if (payload.candidates?.[0]?.content?.parts?.[0]?.text) {
        token = payload.candidates[0].content.parts[0].text;
      }
    } catch (e) {}

    // Directly update the UI thread shared value
    textValue.value = textValue.value + token;
  }, [data, disconnect, textValue]);

  const handleConnect = () => {
    if (!url) return;
    textValue.value = '';
    connect();
  };

  const getStatusText = () => {
    if (error) return `Error: ${error.message}`;
    switch (status) {
      case ReadyState.CONNECTING:
        return 'Connecting...';
      case ReadyState.OPEN:
        return 'Connected';
      case ReadyState.CLOSED:
        return 'Disconnected';
      default:
        return 'Unknown';
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Turbo SSE Demo</Text>
      <TextInput
        style={styles.input}
        placeholder="SSE Endpoint URL"
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
      />

      <View style={styles.row}>
        <Button
          title="Connect"
          onPress={handleConnect}
          disabled={
            status === ReadyState.OPEN || status === ReadyState.CONNECTING
          }
        />
        <Button
          title="Disconnect"
          onPress={disconnect}
          color="red"
          disabled={status === ReadyState.CLOSED}
        />
      </View>

      <Text style={styles.status}>Status: {getStatusText()}</Text>

      <AnimatedScrollView
        ref={scrollViewRef}
        style={styles.logs}
        onContentSizeChange={() => {
          scrollViewRef.current?.scrollToEnd({ animated: true });
        }}
      >
        <AnimatedTextInput
          editable={false}
          multiline
          scrollEnabled={false}
          animatedProps={animatedProps}
          style={styles.logText}
        />
      </AnimatedScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    paddingTop: 60,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  input: {
    height: 40,
    borderColor: 'gray',
    borderWidth: 1,
    marginBottom: 10,
    paddingHorizontal: 10,
    backgroundColor: 'white',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 20,
  },
  status: {
    fontWeight: 'bold',
    marginBottom: 10,
  },

  logs: {
    flex: 1,
    backgroundColor: 'white',
    padding: 10,
    borderColor: '#ccc',
    borderWidth: 1,
  },
  logText: {
    fontFamily: 'monospace',
    fontSize: 14,
  },
});
