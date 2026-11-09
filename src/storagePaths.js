'use strict';

const os = require('os');
const path = require('path');

/**
 * Keep user data outside the extracted source folder so replacing/extracting
 * a new TraceMate ZIP does not silently create a new empty database.
 * TRACEMATE_DATA_DIR is supported for portable installs and test isolation.
 */
function getDataDir(projectRoot = process.cwd(), env = process.env, platform = process.platform, homeDir = os.homedir()) {
  const pathApi = platform === 'win32' ? path.win32 : path;
  if (env.TRACEMATE_DATA_DIR && String(env.TRACEMATE_DATA_DIR).trim()) {
    return pathApi.resolve(String(env.TRACEMATE_DATA_DIR).trim());
  }

  if (platform === 'win32') {
    const roaming = env.APPDATA || pathApi.join(homeDir, 'AppData', 'Roaming');
    return pathApi.join(roaming, 'TraceMate', 'data');
  }

  if (platform === 'darwin') {
    return pathApi.join(homeDir, 'Library', 'Application Support', 'TraceMate', 'data');
  }

  const dataHome = env.XDG_DATA_HOME || pathApi.join(homeDir, '.local', 'share');
  return pathApi.join(dataHome, 'TraceMate', 'data');
}

module.exports = { getDataDir };
