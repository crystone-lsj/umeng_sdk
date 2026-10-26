/**
 * Minimal Apache Thrift binary-protocol codec, sufficient for the Umeng wire
 * protocols. Zero dependencies.
 *
 * Wire format (TBinaryProtocol):
 *   struct  ::= ( fieldHeader value )* 0x00
 *   fieldHeader ::= type:byte id:i16be
 *   string/binary ::= len:i32be bytes
 *   i32 ::= 4 bytes big endian
 *
 * Evidence: UMCommon 7.6.4 `UMEnvelope` (umeng_envelope.o) writes
 * writeFieldBeginWithName:type:fieldID: for ids 1..10 followed by
 * writeFieldStop; the response struct is read as `UMTResponse` and its
 * `resp_code` (field 1, i32) must equal 1 (UMBuildPayload.o `verifyResponseData:`).
 */

export const TType = Object.freeze({
  STOP: 0,
  VOID: 1,
  BOOL: 2,
  BYTE: 3,
  DOUBLE: 4,
  I16: 6,
  I32: 8,
  I64: 10,
  STRING: 11,
  STRUCT: 12,
  MAP: 13,
  SET: 14,
  LIST: 15,
});

/** Thrown for any structurally invalid Thrift payload. */
export class ThriftError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ThriftError';
    this.details = details;
  }
}

function describeType(type) {
  for (const [name, value] of Object.entries(TType)) {
    if (value === type) return name;
  }
  return `0x${type.toString(16)}`;
}

export class ThriftReader {
  constructor(buffer, offset = 0) {
    if (!Buffer.isBuffer(buffer)) {
      throw new ThriftError('ThriftReader requires a Buffer');
    }
    this.buffer = buffer;
    this.offset = offset;
  }

  get remaining() {
    return this.buffer.length - this.offset;
  }

  #require(bytes, what) {
    if (this.remaining < bytes) {
      throw new ThriftError(`truncated payload while reading ${what}`, {
        offset: this.offset,
        needed: bytes,
        remaining: this.remaining,
      });
    }
  }

  readByte() {
    this.#require(1, 'byte');
    return this.buffer[this.offset++];
  }

  readI16() {
    this.#require(2, 'i16');
    const value = this.buffer.readInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  readI32() {
    this.#require(4, 'i32');
    const value = this.buffer.readInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  readI64() {
    this.#require(8, 'i64');
    const value = this.buffer.readBigInt64BE(this.offset);
    this.offset += 8;
    return value;
  }

  readDouble() {
    this.#require(8, 'double');
    const value = this.buffer.readDoubleBE(this.offset);
    this.offset += 8;
    return value;
  }

  /** Raw bytes for T_STRING / T_BINARY (the wire encoding is identical). */
  readBinary(maxLength = Infinity) {
    const length = this.readI32();
    if (length < 0) {
      throw new ThriftError('negative binary length', { length });
    }
    if (length > maxLength) {
      throw new ThriftError('binary length exceeds configured limit', {
        length,
        limit: maxLength,
      });
    }
    this.#require(length, 'binary body');
    const value = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  readString(maxLength = Infinity) {
    return this.readBinary(maxLength).toString('utf8');
  }

  readFieldBegin() {
    const type = this.readByte();
    if (type === TType.STOP) return { type, id: 0 };
    const id = this.readI16();
    return { type, id };
  }

  /** Reads a whole struct body (after the caller has read its own field header). */
  readStructBody({ maxDepth = 8, depth = 0, maxBinaryLength = Infinity } = {}) {
    if (depth > maxDepth) {
      throw new ThriftError('struct nesting too deep', { maxDepth });
    }
    const fields = [];
    for (;;) {
      const { type, id } = this.readFieldBegin();
      if (type === TType.STOP) break;
      const value = this.#readValue(type, { maxDepth, depth, maxBinaryLength });
      fields.push({ id, type, value });
    }
    return fields;
  }

  #readValue(type, ctx) {
    switch (type) {
      case TType.BOOL:
        return this.readByte() !== 0;
      case TType.BYTE:
        return this.readByte();
      case TType.DOUBLE:
        return this.readDouble();
      case TType.I16:
        return this.readI16();
      case TType.I32:
        return this.readI32();
      case TType.I64:
        return this.readI64();
      case TType.STRING:
        return this.readBinary(ctx.maxBinaryLength);
      case TType.STRUCT:
        return this.readStructBody({ ...ctx, depth: ctx.depth + 1 });
      case TType.LIST:
      case TType.SET: {
        const elementType = this.readByte();
        const size = this.readI32();
        if (size < 0 || size > 100000) {
          throw new ThriftError('unreasonable collection size', { size });
        }
        const items = [];
        for (let index = 0; index < size; index += 1) {
          items.push(this.#readValue(elementType, { ...ctx, depth: ctx.depth + 1 }));
        }
        return items;
      }
      case TType.MAP: {
        const keyType = this.readByte();
        const valueType = this.readByte();
        const size = this.readI32();
        if (size < 0 || size > 100000) {
          throw new ThriftError('unreasonable map size', { size });
        }
        const entries = [];
        for (let index = 0; index < size; index += 1) {
          entries.push([
            this.#readValue(keyType, { ...ctx, depth: ctx.depth + 1 }),
            this.#readValue(valueType, { ...ctx, depth: ctx.depth + 1 }),
          ]);
        }
        return entries;
      }
      default:
        throw new ThriftError(`unsupported field type ${describeType(type)}`, { type });
    }
  }
}

export class ThriftWriter {
  #chunks = [];

  writeByte(value) {
    const chunk = Buffer.allocUnsafe(1);
    chunk.writeUInt8(value & 0xff, 0);
    this.#chunks.push(chunk);
    return this;
  }

  writeI16(value) {
    const chunk = Buffer.allocUnsafe(2);
    chunk.writeInt16BE(value, 0);
    this.#chunks.push(chunk);
    return this;
  }

  writeI32(value) {
    const chunk = Buffer.allocUnsafe(4);
    chunk.writeInt32BE(value, 0);
    this.#chunks.push(chunk);
    return this;
  }

  writeFieldBegin(type, id) {
    return this.writeByte(type).writeI16(id);
  }

  writeFieldStop() {
    return this.writeByte(TType.STOP);
  }

  writeString(value) {
    const bytes = Buffer.from(String(value), 'utf8');
    this.writeI32(bytes.length);
    this.#chunks.push(bytes);
    return this;
  }

  writeBinary(value) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    this.writeI32(bytes.length);
    this.#chunks.push(bytes);
    return this;
  }

  toBuffer() {
    return Buffer.concat(this.#chunks);
  }
}

/**
 * Canonical legacy-protocol struct parser used by the Umeng iOS SDK for both
 * `UMEnvelope` and `UMTResponse`: a bare struct at offset 0.
 */
export function readTopLevelStruct(buffer, options = {}) {
  const reader = new ThriftReader(buffer, 0);
  const fields = reader.readStructBody(options);
  return { fields, bytesRead: reader.offset, trailingBytes: reader.remaining };
}

export function fieldsToMap(fields) {
  const map = new Map();
  for (const field of fields) map.set(field.id, field);
  return map;
}
