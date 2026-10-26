/**
 * Umeng iOS `UMEnvelope` decode/encode.
 *
 * Schema (verified from UMCommon 7.6.4 `umeng_envelope.o`, `-[UMEnvelope write:]`,
 * offsets 0x1138..0x1374 — writeFieldBegin calls in order):
 *
 *   1  version     STRING   ("V1.1", UMEnvelopeBuild.o)
 *   2  address     STRING   (appkey)
 *   3  signature   STRING   (hex md5 of the compressed entity)
 *   4  serial_num  I32
 *   5  ts_secs    I32
 *   6  length     I32       (uncompressed entity length, UTF-8 bytes)
 *   7  entity      BINARY   (zlib stream: RFC1950, produced by libz `compress2`)
 *   8  guid       STRING
 *   9  checksum   STRING
 *  10  codex      I32       (1 for the unencrypted path)
 *
 * `entity` is a zlib stream, not gzip and not raw deflate; `+[UMUtils
 * deflatedData:]` -> `deflatedDataPrefixedWith:level:source:` -> `compress2`
 * (UMUtils.o imports `_compress2`). Use `zlib.inflateSync` to decode.
 *
 * checksum = lowercase hex md5 of the UTF-8 string
 *            `"<signature><serial_num><ts_secs><length><guid>"`
 * (UMEnvelopeBuild.o format string `%@%d%d%d%@`).
 */

import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

import { ThriftError, TType, ThriftWriter, fieldsToMap, readTopLevelStruct } from './thrift.js';

export const ENVELOPE_FIELDS = Object.freeze({
  VERSION: 1,
  ADDRESS: 2,
  SIGNATURE: 3,
  SERIAL_NUM: 4,
  TS_SECS: 5,
  LENGTH: 6,
  ENTITY: 7,
  GUID: 8,
  CHECKSUM: 9,
  CODEX: 10,
});

export const DEFAULT_MAX_ENTITY_BYTES = 8 * 1024 * 1024;

/** Thrift binary body the iOS SDK accepts as a successful upload. */
export const SUCCESS_RESPONSE_BYTES = Buffer.from('0800010000000100', 'hex');

export function buildSuccessResponse() {
  const writer = new ThriftWriter();
  writer.writeFieldBegin(TType.I32, 1).writeI32(1).writeFieldStop();
  return writer.toBuffer();
}

export function buildEnvelope(envelope) {
  const writer = new ThriftWriter();
  writer.writeFieldBegin(TType.STRING, ENVELOPE_FIELDS.VERSION).writeString(envelope.version);
  writer.writeFieldBegin(TType.STRING, ENVELOPE_FIELDS.ADDRESS).writeString(envelope.address);
  writer.writeFieldBegin(TType.STRING, ENVELOPE_FIELDS.SIGNATURE).writeString(envelope.signature);
  writer.writeFieldBegin(TType.I32, ENVELOPE_FIELDS.SERIAL_NUM).writeI32(envelope.serialNum);
  writer.writeFieldBegin(TType.I32, ENVELOPE_FIELDS.TS_SECS).writeI32(envelope.tsSecs);
  writer.writeFieldBegin(TType.I32, ENVELOPE_FIELDS.LENGTH).writeI32(envelope.length);
  writer.writeFieldBegin(TType.STRING, ENVELOPE_FIELDS.ENTITY).writeBinary(envelope.entity);
  writer.writeFieldBegin(TType.STRING, ENVELOPE_FIELDS.GUID).writeString(envelope.guid);
  writer.writeFieldBegin(TType.STRING, ENVELOPE_FIELDS.CHECKSUM).writeString(envelope.checksum);
  writer.writeFieldBegin(TType.I32, ENVELOPE_FIELDS.CODEX).writeI32(envelope.codex ?? 1);
  writer.writeFieldStop();
  return writer.toBuffer();
}

function expectString(field, id, name, errors) {
  if (!field) {
    errors.push(`missing required field ${id} (${name})`);
    return null;
  }
  if (field.type !== TType.STRING) {
    errors.push(`field ${id} (${name}) has unexpected type ${field.type}`);
    return null;
  }
  // The thrift reader keeps T_STRING/T_BINARY as raw bytes (identical wire
  // encoding). The envelope schema is the owner that knows which fields are
  // text, so it is the boundary that decodes them exactly once.
  return Buffer.from(field.value).toString('utf8');
}

function expectBinary(field, id, name, errors) {
  if (!field) {
    errors.push(`missing required field ${id} (${name})`);
    return null;
  }
  if (field.type !== TType.STRING) {
    errors.push(`field ${id} (${name}) has unexpected type ${field.type}`);
    return null;
  }
  return field.value;
}

function expectI32(field, id, name, errors) {
  if (!field) {
    errors.push(`missing required field ${id} (${name})`);
    return null;
  }
  if (field.type !== TType.I32) {
    errors.push(`field ${id} (${name}) has unexpected type ${field.type}`);
    return null;
  }
  return field.value;
}

/**
 * Structural decode only; does not verify integrity. Never throws on malformed
 * business fields — collects `errors` instead so callers can still archive the
 * raw bytes.
 */
export function parseEnvelope(buffer, options = {}) {
  const { maxEntityBytes = DEFAULT_MAX_ENTITY_BYTES } = options;
  const errors = [];
  let parsed;
  try {
    parsed = readTopLevelStruct(buffer, { maxBinaryLength: maxEntityBytes + 64 });
  } catch (error) {
    if (error instanceof ThriftError) {
      return { ok: false, errors: [error.message], thrift: error.details, envelope: null };
    }
    throw error;
  }

  const fields = fieldsToMap(parsed.fields);
  const envelope = {
    version: expectString(fields.get(ENVELOPE_FIELDS.VERSION), ENVELOPE_FIELDS.VERSION, 'version', errors),
    address: expectString(fields.get(ENVELOPE_FIELDS.ADDRESS), ENVELOPE_FIELDS.ADDRESS, 'address', errors),
    signature: expectString(fields.get(ENVELOPE_FIELDS.SIGNATURE), ENVELOPE_FIELDS.SIGNATURE, 'signature', errors),
    serialNum: expectI32(fields.get(ENVELOPE_FIELDS.SERIAL_NUM), ENVELOPE_FIELDS.SERIAL_NUM, 'serial_num', errors),
    tsSecs: expectI32(fields.get(ENVELOPE_FIELDS.TS_SECS), ENVELOPE_FIELDS.TS_SECS, 'ts_secs', errors),
    length: expectI32(fields.get(ENVELOPE_FIELDS.LENGTH), ENVELOPE_FIELDS.LENGTH, 'length', errors),
    entity: expectBinary(fields.get(ENVELOPE_FIELDS.ENTITY), ENVELOPE_FIELDS.ENTITY, 'entity', errors),
    guid: expectString(fields.get(ENVELOPE_FIELDS.GUID), ENVELOPE_FIELDS.GUID, 'guid', errors),
    checksum: expectString(fields.get(ENVELOPE_FIELDS.CHECKSUM), ENVELOPE_FIELDS.CHECKSUM, 'checksum', errors),
    codex: expectI32(fields.get(ENVELOPE_FIELDS.CODEX), ENVELOPE_FIELDS.CODEX, 'codex', errors),
    unknownFieldIds: parsed.fields
      .map((field) => field.id)
      .filter((id) => !Object.values(ENVELOPE_FIELDS).includes(id)),
  };

  return {
    ok: errors.length === 0,
    errors,
    envelope,
    bytesRead: parsed.bytesRead,
    trailingBytes: parsed.trailingBytes,
  };
}

export function md5Hex(data) {
  return createHash('md5').update(data).digest('hex');
}

/**
 * Integrity facts about a decoded envelope. `null` means "not evaluated"
 * (missing input) rather than "verified false".
 */
export function checkIntegrity(envelope) {
  if (!envelope?.entity) return null;
  const entity = Buffer.isBuffer(envelope.entity) ? envelope.entity : Buffer.from(envelope.entity);
  const result = {
    entityBytes: entity.byteLength,
    declaredLength: envelope.length ?? null,
    signatureExpected: md5Hex(entity),
    signatureMatches:
      typeof envelope.signature === 'string' ? md5Hex(entity) === envelope.signature.toLowerCase() : null,
  };
  if (typeof envelope.checksum === 'string' && envelope.guid != null) {
    const material = Buffer.from(
      `${envelope.signature ?? ''}${envelope.serialNum ?? 0}${envelope.tsSecs ?? 0}${
        envelope.length ?? 0
      }${envelope.guid}`,
      'utf8'
    );
    result.checksumExpected = md5Hex(material);
    result.checksumMatches = result.checksumExpected === envelope.checksum.toLowerCase();
  }
  return result;
}

/**
 * Decompresses the zlib entity and, when the payload is JSON (the shape the
 * analytics SDK writes), parses it. Failures are reported instead of thrown so
 * the raw entity can still be archived.
 */
export function decodeEntity(entity, options = {}) {
  const { maxOutputLength = DEFAULT_MAX_ENTITY_BYTES } = options;
  if (!entity || entity.byteLength === 0) {
    return { ok: false, error: 'empty entity', text: null, json: null };
  }
  let text;
  try {
    text = inflateSync(entity, { maxOutputLength }).toString('utf8');
  } catch (error) {
    return { ok: false, error: `inflate failed: ${error.message}`, text: null, json: null };
  }
  let json = null;
  let jsonError = null;
  try {
    json = JSON.parse(text);
  } catch (error) {
    jsonError = error.message;
  }
  return { ok: true, text, json, jsonError };
}

/** Full decode path used by the receiver. */
export function decodeEnvelopeRequest(buffer, options = {}) {
  const parsed = parseEnvelope(buffer, options);
  if (!parsed.envelope) return { ...parsed, integrity: null, entity: null };
  const integrity = checkIntegrity(parsed.envelope);
  const entity = decodeEntity(parsed.envelope.entity, options);
  if (integrity && entity.ok && entity.text != null) {
    integrity.declaredLengthMatches = Buffer.byteLength(entity.text, 'utf8') === integrity.declaredLength;
  }
  return { ...parsed, integrity, entity };
}
