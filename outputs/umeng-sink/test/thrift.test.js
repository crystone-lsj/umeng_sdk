import assert from 'node:assert/strict';
import test from 'node:test';

import { TType, ThriftError, ThriftReader, ThriftWriter, fieldsToMap, readTopLevelStruct } from '../src/thrift.js';

test('writer/reader round-trips a struct', () => {
  const writer = new ThriftWriter();
  writer
    .writeFieldBegin(TType.STRING, 1)
    .writeString('V1.1')
    .writeFieldBegin(TType.I32, 4)
    .writeI32(7)
    .writeFieldBegin(TType.STRING, 7)
    .writeBinary(Buffer.from([0x00, 0xff, 0x10]))
    .writeFieldStop();

  const buffer = writer.toBuffer();
  const { fields, trailingBytes } = readTopLevelStruct(buffer);
  const map = fieldsToMap(fields);

  assert.equal(trailingBytes, 0);
  assert.equal(map.get(1).value.toString('utf8'), 'V1.1');
  assert.equal(map.get(4).value, 7);
  assert.deepEqual([...map.get(7).value], [0x00, 0xff, 0x10]);
});

test('binary yields a subarray view, not a copy', () => {
  const writer = new ThriftWriter();
  writer.writeFieldBegin(TType.STRING, 1).writeBinary(Buffer.from('abc')).writeFieldStop();
  const buffer = writer.toBuffer();
  const map = fieldsToMap(readTopLevelStruct(buffer).fields);
  assert.equal(map.get(1).value.buffer, buffer.buffer);
});

test('truncated payload raises a structured error', () => {
  const writer = new ThriftWriter();
  writer.writeFieldBegin(TType.STRING, 1).writeString('abcdef').writeFieldStop();
  const buffer = writer.toBuffer();
  assert.throws(
    () => readTopLevelStruct(buffer.subarray(0, buffer.length - 3)),
    (error) => error instanceof ThriftError && /truncated/.test(error.message)
  );
});

test('negative and oversized lengths are rejected', () => {
  assert.throws(() => readTopLevelStruct(Buffer.from('0b0001ffffffff00', 'hex')), ThriftError);
  assert.throws(
    () => readTopLevelStruct(Buffer.from('0b00010000001000', 'hex'), { maxBinaryLength: 4 }),
    (error) => error instanceof ThriftError && /exceeds configured limit/.test(error.message)
  );
});

test('unsupported field types are rejected instead of misparsed', () => {
  // field type 0x09 is not a valid TBinaryProtocol type.
  assert.throws(
    () => readTopLevelStruct(Buffer.from('09000100', 'hex')),
    (error) => error instanceof ThriftError && /unsupported field type/.test(error.message)
  );
});

test('reader exposes remaining bytes for framing checks', () => {
  const reader = new ThriftReader(Buffer.from('0001', 'hex'));
  assert.equal(reader.remaining, 2);
  assert.equal(reader.readI16(), 1);
  assert.equal(reader.remaining, 0);
});
