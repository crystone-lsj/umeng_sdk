/**
 * Durable NDJSON archive for received reports, plus a bounded in-memory ring
 * used by the debug endpoints.
 *
 * Design notes:
 *  - Records are appended as one JSON document per line, rotated daily per
 *    channel, so a malformed line can never corrupt neighbouring evidence.
 *  - Each channel owns exactly one open stream (the current day's file). A
 *    stream is only closed once its own queued writes have landed, so channels
 *    that interleave on the same day cannot end each other's stream mid-write.
 *  - Raw payload bytes are preserved (base64) alongside the parsed view, so
 *    nothing is lost when a decoder is incomplete.
 *  - The ring buffer is bounded; growth is capped instead of silently
 *    accumulating in memory.
 */

import { createWriteStream, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MAX_RING_ENTRIES = 500;
const MAX_RAW_BASE64_BYTES = 512 * 1024;

function dayStamp(date = new Date()) {
  const iso = date.toISOString();
  return iso.slice(0, 10);
}

function truncateBase64(buffer, limit = MAX_RAW_BASE64_BYTES) {
  if (!Buffer.isBuffer(buffer)) return null;
  const clipped = buffer.length > limit ? buffer.subarray(0, limit) : buffer;
  return {
    encoding: 'base64',
    bytes: buffer.length,
    truncated: buffer.length > limit,
    data: clipped.toString('base64'),
  };
}

export class SinkStore {
  #dataDir;
  #streams = new Map();
  #retirements = [];
  #ring = [];
  #stats = new Map();
  #closed = false;
  #mirror;

  constructor({ dataDir = './data', ringSize = MAX_RING_ENTRIES, mirror = null } = {}) {
    this.#mirror = mirror;
    this.#dataDir = resolve(dataDir);
    this.ringSize = ringSize;
    mkdirSync(this.#dataDir, { recursive: true });
  }

  get dataDir() {
    return this.#dataDir;
  }

  #streamFor(channel) {
    const day = dayStamp();
    const key = `${channel}-${day}`;
    const existing = this.#streams.get(key);
    if (existing) return existing;

    const file = join(this.#dataDir, `${key}.ndjson`);
    const stream = createWriteStream(file, { flags: 'a' });
    stream.on('error', (error) => {
      process.emitWarning(`umeng-sink: write error on ${file}: ${error.message}`);
    });
    // `pending` tracks durable completion of this stream's queued writes so
    // `flush()`, rotation and `close()` can await it instead of guessing from
    // `writableLength`.
    const entry = { key, channel, file, stream, pending: Promise.resolve() };
    this.#streams.set(key, entry);

    // Day rotation: retire this channel's previous file, but only after its own
    // writes have landed. Other channels are untouched.
    for (const [otherKey, other] of this.#streams) {
      if (otherKey === key || other.channel !== channel) continue;
      this.#streams.delete(otherKey);
      this.#retirements.push(
        other.pending
          .catch(() => {})
          .then(() => new Promise((resolvePromise) => other.stream.end(() => resolvePromise())))
      );
    }
    return entry;
  }

  /**
   * @param {string} channel logical channel, e.g. `ios-analytics`, `h5-logs`
   * @param {object} record parsed facts (already JSON-safe)
   * @param {Buffer|null} raw original body bytes
   */
  write(channel, record, raw = null) {
    if (this.#closed) throw new Error('SinkStore is closed');
    const event = {
      receivedAt: new Date().toISOString(),
      channel,
      ...record,
    };
    if (raw) event.rawBody = truncateBase64(raw);
    this.#mirror?.prepare(event);

    this.#ring.push(event);
    if (this.#ring.length > this.ringSize) this.#ring.splice(0, this.#ring.length - this.ringSize);

    const stat = this.#stats.get(channel) ?? { channel, count: 0, firstAt: event.receivedAt, lastAt: null };
    stat.count += 1;
    stat.lastAt = event.receivedAt;
    this.#stats.set(channel, stat);

    const entry = this.#streamFor(channel);
    // `stream.write` is invoked synchronously so it can never be aimed at a
    // stream that a later call retires in the same tick. Durability is tracked
    // separately on `entry.pending`, and backpressure is not awaited by callers:
    // the ring keeps the newest events available while the stream drains.
    const line = `${JSON.stringify(event)}\n`;
    const landed = new Promise((resolvePromise, rejectPromise) => {
      try {
        entry.stream.write(line, (error) => (error ? rejectPromise(error) : resolvePromise()));
      } catch (error) {
        rejectPromise(error);
      }
    });
    // The chain is kept alive across failures so one bad write cannot silently
    // stop the archive.
    entry.pending = entry.pending.catch(() => {}).then(() => landed);
    // A failed mirror cannot fail the receiver; a failed local append must not be mirrored.
    if (this.#mirror) landed.then(() => this.#mirror.enqueue(event), () => {});
    return event;
  }

  recent({ limit = 50, channel = null } = {}) {
    const filtered = channel ? this.#ring.filter((event) => event.channel === channel) : this.#ring;
    return filtered.slice(Math.max(0, filtered.length - limit)).reverse();
  }

  stats() {
    return {
      dataDir: this.#dataDir,
      ringEntries: this.#ring.length,
      channels: [...this.#stats.values()].sort((a, b) => a.channel.localeCompare(b.channel)),
    };
  }

  /** Waits for queued file writes to flush (used by tests and clean shutdown). */
  async flush() {
    await Promise.all([
      ...[...this.#streams.values()].map((entry) => entry.pending.catch(() => {})),
      ...this.#retirements.map((retirement) => retirement.catch(() => {})),
    ]);
  }

  async close() {
    this.#closed = true;
    await this.flush();
    this.#retirements.length = 0;
    await Promise.all(
      [...this.#streams.values()].map(
        (entry) =>
          new Promise((resolvePromise) => {
            entry.stream.end(() => resolvePromise());
          })
      )
    );
    this.#streams.clear();
  }
}

export { dayStamp, truncateBase64 };
