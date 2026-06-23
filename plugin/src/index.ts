import { type ConfigPlugin, withPlugins } from '@expo/config-plugins';
import { withFastSseIos } from './withIos';
import { withFastSseAndroid } from './withAndroid';

const withFastSse: ConfigPlugin = (config) => {
  return withPlugins(config, [withFastSseIos, withFastSseAndroid]);
};

export default withFastSse;
