import fs from 'node:fs/promises';
import yaml from 'js-yaml';
import { resolveProjectPath } from './path-resolver.js';

const cache = new Map();

/**
 * Load a YAML config file from configs/<name>.yaml.
 * @param {string} name
 * @returns {Promise<any>}
 */
export async function loadConfig(name) {
  if (cache.has(name)) {
    return cache.get(name);
  }
  const filePath = resolveProjectPath('configs', `${name}.yaml`);
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = yaml.load(raw);
  cache.set(name, parsed);
  return parsed;
}
