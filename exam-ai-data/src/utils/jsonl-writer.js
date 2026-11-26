import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

/**
 * Streaming JSONL writer that ensures parent directory exists.
 */
export class JsonlWriter {
  /**
   * @param {string} filePath
   * @param {{ append?: boolean }} [options]
   */
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.append = Boolean(options.append);
    this.stream = null;
    this.count = 0;
  }

  async open() {
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    this.stream = fs.createWriteStream(this.filePath, {
      flags: this.append ? 'a' : 'w',
      encoding: 'utf8',
    });
    return this;
  }

  /**
   * Write a single object as a JSON line, handling backpressure.
   * @param {unknown} record
   */
  async write(record) {
    if (!this.stream) {
      await this.open();
    }
    const line = JSON.stringify(record) + '\n';
    this.count += 1;
    if (!this.stream.write(line, 'utf8')) {
      await new Promise((resolve) => this.stream.once('drain', resolve));
    }
  }

  async close() {
    if (!this.stream) return;
    await new Promise((resolve, reject) => {
      this.stream.end((err) => (err ? reject(err) : resolve()));
    });
    this.stream = null;
  }
}

/**
 * Streamingly read a JSONL file line by line.
 * @param {string} filePath
 * @returns {AsyncGenerator<any, void, unknown>}
 */
export async function* readJsonlStream(filePath) {
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    yield JSON.parse(trimmed);
  }
}

/**
 * Read all records from a JSONL file into a Map keyed by keyFn.
 * @param {string} filePath
 * @param {(item: any) => string} keyFn
 * @returns {Promise<Map<string, any>>}
 */
export async function readJsonlMap(filePath, keyFn) {
  const map = new Map();
  try {
    await fsp.access(filePath);
  } catch {
    return map;
  }
  for await (const item of readJsonlStream(filePath)) {
    map.set(keyFn(item), item);
  }
  return map;
}
