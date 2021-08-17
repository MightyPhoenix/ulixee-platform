import { ChildProcess, spawn, SpawnOptions, StdioOptions } from 'child_process';
import {
  getBinaryPath,
  getLocalBuildPath,
  isBinaryInstalled,
  isLocalBuildPresent,
} from './install/Utils';

const launchPaths = {
  local: getLocalBuildPath(),
  binary: getBinaryPath(),
  workspace: `yarn workspace @ulixee/apps-chromealive start`,
};

export default function launchChromeAlive(...launchArgs: string[]): ChildProcess {
  const showDebugLogs = Boolean(JSON.parse(process.env.ULX_CHROMEALIVE_DEBUG ?? 'false'));

  let stdio: StdioOptions;
  if (showDebugLogs) {
    stdio = ['ignore', 'inherit', 'inherit'];
  } else {
    stdio = ['ignore', 'ignore', 'ignore'];
  }
  if (process.platform === 'win32') {
    // add an ipc pipe to send a close message
    stdio.push('ipc');
  }

  const spawnOptions: SpawnOptions = {
    stdio,
    windowsHide: false,
  };

  const preferredLaunch = getPreferredLaunch();
  if (!preferredLaunch) return;
  if (preferredLaunch === 'workspace') spawnOptions.shell = true;

  const exe = launchPaths[preferredLaunch];

  const child = spawn(
    exe,
    ['--chromealive', `--${preferredLaunch}-launch`, '--enable-logging', ...launchArgs],
    spawnOptions,
  );

  child.unref();
  return child;
}

function getPreferredLaunch(): 'local' | 'workspace' | 'binary' {
  if (isLocalBuildPresent()) {
    return 'local';
  }

  const forceBinary = JSON.parse(process.env.ULX_USE_CHROMEALIVE_BINARY ?? 'false');
  if (!forceBinary) {
    try {
      require.resolve('./app');
      return 'workspace';
    } catch (err) {
      // not installed locally
    }
  }

  if (isBinaryInstalled()) {
    return 'binary';
  }
}