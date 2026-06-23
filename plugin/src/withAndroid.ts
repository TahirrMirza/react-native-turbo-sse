import { type ConfigPlugin, withGradleProperties } from '@expo/config-plugins';

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
