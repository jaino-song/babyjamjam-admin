const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../../..');
const mobileRequire = createRequire(path.join(root, 'mobile/package.json'));
function installed(name) {
  try { return mobileRequire(name); } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    const store = path.join(root, 'node_modules/.pnpm');
    const prefix = `${name.replace('/', '+')}@`;
    const candidates = fs.readdirSync(store).filter(entry => entry.startsWith(prefix));
    if (candidates.length !== 1) throw new Error(`Expected one installed ${name}, found ${candidates.length}. Run the existing frozen workspace install first.`);
    return require(path.join(store, candidates[0], 'node_modules', name));
  }
}
module.exports = { installed, root };
