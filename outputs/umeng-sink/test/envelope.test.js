import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { deflateRawSync, deflateSync, gzipSync } from 'node:zlib';

import {
  buildEnvelope,
  buildSuccessResponse,
  checkIntegrity,
  decodeEnvelopeRequest,
  decodeEntity,
  parseEnvelope,
} from '../src/envelope.js';

/**
 * Golden fixture produced by an independent (Python) implementation of the
 * UMEnvelope wire format documented in umeng-analysis/ios-protocol.md, so this
 * test cross-checks the JS decoder rather than only round-tripping it.
 */
const GOLDEN = {
  envelopeHex:
    '0b00010000000456312e310b0002000000183639346130323538383536306533343837323064656632610b000300000020376337656635653336663262363765376332353936666563333439336630386608000400000007080005694602580800060000007b0b000700000070789c1d8cc10a84300c44ff25e70af6b0baebafc82241831b5c2b985494d27f37f532306f7893e04738d10e5d824da003b67410579eac0887a55212ade668203bc080ff4b799422e0a87cd010a5f8de011d14d4963ec1a3e3790eb26e0bd963e1be6d1aff79bdeb3a7f73be01fac628780b00080000002065356535653565356535653565356535653565356535653565356535653565350b000900000020323839343566383966343137613333326665633461383662313365303237383808000a0000000100',
  json: '{"header":{"os":"ios","umid":"sink-test-guid"},"analytics":{"active_user":1,"events":[{"id":"axx_smoke","ts":1766195800}]}}',
  signature: '7c7ef5e36f2b67e7c2596fec3493f08f',
  checksum: '28945f89f417a332fec4a86b13e02788',
  serialNum: 7,
  tsSecs: 1766195800,
  length: 123,
  guid: 'e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5',
};

test('decodes the golden UMEnvelope fixture', () => {
  const buffer = Buffer.from(GOLDEN.envelopeHex, 'hex');
  const result = decodeEnvelopeRequest(buffer);

  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.envelope.version, 'V1.1');
  assert.equal(result.envelope.address, '694a02588560e348720def2a');
  assert.equal(result.envelope.serialNum, GOLDEN.serialNum);
  assert.equal(result.envelope.tsSecs, GOLDEN.tsSecs);
  assert.equal(result.envelope.length, GOLDEN.length);
  assert.equal(result.envelope.guid, GOLDEN.guid);
  assert.equal(result.envelope.signature, GOLDEN.signature);
  assert.equal(result.envelope.checksum, GOLDEN.checksum);
  assert.equal(result.envelope.codex, 1);
  assert.deepEqual(result.envelope.unknownFieldIds, []);
  assert.equal(result.trailingBytes, 0);
});

test('entity decodes with zlib (RFC1950), not gzip or raw deflate', () => {
  const result = decodeEnvelopeRequest(Buffer.from(GOLDEN.envelopeHex, 'hex'));
  assert.equal(result.entity.ok, true, result.entity.error);
  assert.equal(result.entity.text, GOLDEN.json);
  assert.deepEqual(result.entity.json, JSON.parse(GOLDEN.json));
  assert.equal(result.integrity.signatureMatches, true);
  assert.equal(result.integrity.checksumMatches, true);
  assert.equal(result.integrity.declaredLengthMatches, true);
  assert.equal(result.integrity.entityBytes, 112);
});

test('gzip and raw-deflate entities are rejected, not silently accepted', () => {
  const raw = Buffer.from(GOLDEN.json, 'utf8');
  assert.equal(decodeEntity(gzipSync(raw)).ok, false);
  assert.equal(decodeEntity(deflateRawSync(raw)).ok, false);
  // The documented encoding is the zlib/RFC1950 stream produced by compress2.
  assert.equal(decodeEntity(deflateSync(raw)).text, GOLDEN.json);
});

test('round-trips an envelope built by this package', () => {
  const raw = Buffer.from('{"a":1}', 'utf8');
  const entity = deflateSync(raw, { level: -1 });
  const signature = createHash('md5').update(entity).digest('hex');
  const guid = 'a'.repeat(32);
  const checksum = createHash('md5')
    .update(`${signature}3${1766195800}${raw.length}${guid}`)
    .digest('hex');

  const buffer = buildEnvelope({
    version: 'V1.1',
    address: 'appkey',
    signature,
    serialNum: 3,
    tsSecs: 1766195800,
    length: raw.length,
    entity,
    guid,
    checksum,
    codex: 1,
  });

  const decoded = decodeEnvelopeRequest(buffer);
  assert.equal(decoded.ok, true, decoded.errors.join('; '));
  assert.equal(decoded.entity.text, '{"a":1}');
  assert.equal(decoded.integrity.signatureMatches, true);
  assert.equal(decoded.integrity.checksumMatches, true);
});

test('structural damage is reported without throwing', () => {
  const result = decodeEnvelopeRequest(Buffer.from('0b0001ffffffffffffffff', 'hex'));
  assert.equal(result.ok, false);
  assert.equal(result.envelope, null);
  assert.match(result.errors[0], /truncated|negative/);
});

test('missing required fields are collected', () => {
  const buffer = Buffer.from('0b00010000000456312e3100', 'hex'); // only `version`
  const result = parseEnvelope(buffer);
  assert.equal(result.ok, false);
  assert.equal(result.envelope.version, 'V1.1');
  assert.equal(result.errors.length, 9);
  assert.ok(result.errors.some((message) => /address/.test(message)));
});

test('integrity is unknown (null) rather than false when inputs are absent', () => {
  assert.equal(checkIntegrity(null), null);
  assert.equal(checkIntegrity({ entity: null }), null);
  const integrity = checkIntegrity({ entity: Buffer.from('abc'), signature: undefined });
  assert.equal(integrity.signatureMatches, null);
  assert.equal(integrity.checksumMatches, undefined);
});

test('success response matches the byte sequence the iOS SDK requires', () => {
  const expected = Buffer.from('0800010000000100', 'hex');
  assert.deepEqual(buildSuccessResponse(), expected);
  // struct: field type 8 (i32), id 1, value 1, stop
  assert.equal(expected[0], 8);
  assert.equal(expected.readInt16BE(1), 1);
  assert.equal(expected.readInt32BE(3), 1);
  assert.equal(expected[7], 0);
});
