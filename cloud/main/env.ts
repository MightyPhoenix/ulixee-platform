import { loadEnv, parseEnvBool, parseEnvList, parseEnvPath } from '@ulixee/commons/lib/envUtils';
import Identity from '@ulixee/crypto/lib/Identity';
import * as Path from 'path';

loadEnv(process.cwd());
loadEnv(__dirname);
const env = process.env;

if (env.ULX_NETWORK_IDENTITY_PATH)
  env.ULX_NETWORK_IDENTITY_PATH = parseEnvPath(env.ULX_NETWORK_IDENTITY_PATH);

export default {
  disableChromeAlive: env.NODE_ENV === 'test' || parseEnvBool(env.ULX_DISABLE_CHROMEALIVE),
  servicesSetupHost: env.ULX_SERVICES_SETUP_HOST,
  nodeRegistryHost: env.ULX_NODE_REGISTRY_HOST,
  cloudType: env.ULX_CLOUD_TYPE === 'public' ? 'public' : 'private',
  kadEnabled: parseEnvBool(env.ULX_ENABLE_KAD),
  kadBootstrapPeers: parseEnvList(env.ULX_BOOTSTRAP_PEERS),
  kadDbPath: env.ULX_KAD_PATH ?? Path.resolve(env.ULX_DATASTORE_DIR, '../kad.db'),
  networkIdentity: env.ULX_NETWORK_IDENTITY_PATH
    ? Identity.loadFromFile(env.ULX_NETWORK_IDENTITY_PATH, {
        keyPassphrase: env.ULX_NETWORK_IDENTITY_PASSPHRASE,
      })
    : null,
  publicPort: env.ULX_PORT ?? env.PORT,
  publicHostname: env.ULX_HOSTNAME,
  hostedServicesPort: env.ULX_HOSTED_SERVICES_PORT,
  hostedServicesHostname: env.ULX_HOSTED_SERVICES_HOSTNAME,
};
