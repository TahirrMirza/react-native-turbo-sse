import {
  type ConfigPlugin,
  withInfoPlist,
  withPodfileProperties,
} from '@expo/config-plugins';

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
    const current = parseFloat(
      (c.modResults['ios.deploymentTarget'] as string) ?? '0'
    );
    if (current < 15.1) {
      c.modResults['ios.deploymentTarget'] = '15.1';
    }
    return c;
  });

  return config;
};
