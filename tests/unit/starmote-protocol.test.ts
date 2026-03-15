import { describe, it, expect } from 'vitest';

import {
  decodeExecuteAdminCommandReturnPacket,
  decodeLoginResponsePacket,
  decodeStarmotePacket,
  encodeAdminCommandPacket,
  encodeExecuteAdminCommandSuperPacket,
  encodeLoginRequestSuperPacket,
  encodeStarmotePacket,
  STARMOTE_COMMAND_IDS,
  STARMOTE_PROTOCOL_VERSION,
} from '../../electron/starmote-protocol.js';

function encodeJavaUtf(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  const out = Buffer.allocUnsafe(2 + bytes.byteLength);
  out.writeUInt16BE(bytes.byteLength, 0);
  bytes.copy(out, 2);
  return out;
}

function createExecuteAdminCommandResponseFrame(lines: string[]): Buffer {
  const encoded = lines.map((line) => encodeJavaUtf(line));
  const payloadLength = 1 + 2 + 1 + 1 + 4 + encoded.reduce((sum, part) => sum + 1 + part.byteLength, 0);
  const payload = Buffer.allocUnsafe(payloadLength);

  let offset = 0;
  payload.writeUInt8(42, offset);
  offset += 1;
  payload.writeInt16BE(-1, offset);
  offset += 2;
  payload.writeUInt8(2, offset);
  offset += 1;
  payload.writeUInt8(111, offset);
  offset += 1;
  payload.writeInt32BE(encoded.length, offset);
  offset += 4;

  for (const part of encoded) {
    payload.writeUInt8(4, offset);
    offset += 1;
    part.copy(payload, offset);
    offset += part.byteLength;
  }

  const frame = Buffer.allocUnsafe(4 + payload.byteLength);
  frame.writeUInt32BE(payload.byteLength, 0);
  payload.copy(frame, 4);
  return frame;
}

function createLoginResponseFrame(code: number, extraReason?: string): Buffer {
  const version = encodeJavaUtf('0.203.999');
  const reason = encodeJavaUtf(extraReason ?? '');
  const hasReason = typeof extraReason === 'string';
  const parameterCount = hasReason ? 5 : 4;
  const payloadLength = 5
    + 4
    + 1 + 4
    + 1 + 4
    + 1 + 8
    + 1 + version.byteLength
    + (hasReason ? 1 + reason.byteLength : 0);
  const payload = Buffer.allocUnsafe(payloadLength);

  let offset = 0;
  payload.writeUInt8(42, offset);
  offset += 1;
  payload.writeInt16BE(-1, offset);
  offset += 2;
  payload.writeUInt8(0, offset);
  offset += 1;
  payload.writeUInt8(111, offset);
  offset += 1;
  payload.writeInt32BE(parameterCount, offset);
  offset += 4;

  payload.writeUInt8(1, offset);
  offset += 1;
  payload.writeInt32BE(code, offset);
  offset += 4;

  payload.writeUInt8(1, offset);
  offset += 1;
  payload.writeInt32BE(123, offset);
  offset += 4;

  payload.writeUInt8(2, offset);
  offset += 1;
  payload.writeBigInt64BE(BigInt(1710450000000), offset);
  offset += 8;

  payload.writeUInt8(4, offset);
  offset += 1;
  version.copy(payload, offset);
  offset += version.byteLength;

  if (hasReason) {
    payload.writeUInt8(4, offset);
    offset += 1;
    reason.copy(payload, offset);
  }

  const frame = Buffer.allocUnsafe(4 + payload.byteLength);
  frame.writeUInt32BE(payload.byteLength, 0);
  payload.copy(frame, 4);
  return frame;
}

describe('starmote-protocol framing', () => {
  it('encodes length-prefixed frames by default and decodes them', () => {
    const frame = encodeAdminCommandPacket('/player_list');
    expect(Buffer.from(frame).toString('ascii', 0, 4)).not.toBe('SM4T');

    const decoded = decodeStarmotePacket(frame);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.packet.version).toBe(STARMOTE_PROTOCOL_VERSION);
      expect(decoded.packet.commandId).toBe(STARMOTE_COMMAND_IDS.ADMIN_COMMAND);
      expect(Buffer.from(decoded.packet.payload).toString('utf8')).toBe('/player_list');
    }
  });

  it('encodes and decodes legacy-sm4t frames when requested', () => {
    const frame = encodeAdminCommandPacket('/shutdown 10', 'legacy-sm4t');
    expect(Buffer.from(frame).toString('ascii', 0, 4)).toBe('SM4T');

    const decoded = decodeStarmotePacket(frame);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.packet.commandId).toBe(STARMOTE_COMMAND_IDS.ADMIN_COMMAND);
      expect(Buffer.from(decoded.packet.payload).toString('utf8')).toBe('/shutdown 10');
    }
  });

  it('rejects malformed length-prefixed frame lengths', () => {
    const valid = Buffer.from(encodeStarmotePacket(0x1234, Buffer.from('abc', 'utf8')));
    valid.writeUInt32BE(9999, 0);

    const decoded = decodeStarmotePacket(valid);
    expect(decoded.ok).toBe(false);
    if (decoded.ok === false) {
      expect(decoded.error).toContain('length');
    }
  });

  it('encodes ExecuteAdminCommand packet using schine header and typed string params', () => {
    const frame = Buffer.from(encodeExecuteAdminCommandSuperPacket('/player_list', ''));
    expect(frame.readUInt32BE(0)).toBe(frame.byteLength - 4);
    expect(frame.readUInt8(4)).toBe(42);
    expect(frame.readInt16BE(5)).toBe(-1);
    expect(frame.readUInt8(7)).toBe(2);
    expect(frame.readUInt8(8)).toBe(111);
    expect(frame.readInt32BE(9)).toBe(2);
    expect(frame.readUInt8(13)).toBe(4);
    expect(frame.readUInt16BE(14)).toBe(0);
    expect(frame.readUInt8(16)).toBe(4);
    expect(frame.readUInt16BE(17)).toBe('/player_list'.length);
    expect(frame.subarray(19).toString('utf8')).toBe('/player_list');
  });

  it('decodes ExecuteAdminCommand return packets with typed string parameters', () => {
    const frame = createExecuteAdminCommandResponseFrame([
      '[PL] Name: Alpha',
      'SQL QUERY 19 BEGIN',
      'SQL#19: id,name',
    ]);

    const decoded = decodeExecuteAdminCommandReturnPacket(frame);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.packet.commandId).toBe(2);
      expect(decoded.packet.stringParams).toEqual([
        '[PL] Name: Alpha',
        'SQL QUERY 19 BEGIN',
        'SQL#19: id,name',
      ]);
    }
  });

  it('encodes Login request packet with expected command id and typed parameters', () => {
    const frame = Buffer.from(encodeLoginRequestSuperPacket({
      playerName: 'AdminUser',
      clientVersion: '0.203.999',
      uniqueSessionId: 'acct-1',
      authToken: 'token-123',
      userAgent: 1,
    }));

    expect(frame.readUInt32BE(0)).toBe(frame.byteLength - 4);
    expect(frame.readUInt8(4)).toBe(42);
    expect(frame.readUInt8(7)).toBe(0);
    expect(frame.readUInt8(8)).toBe(111);
    expect(frame.readInt32BE(9)).toBe(5);
  });

  it('decodes Login response packets with optional extra reason', () => {
    const frame = createLoginResponseFrame(-7, 'auth failed');
    const decoded = decodeLoginResponsePacket(frame);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.packet.code).toBe(-7);
      expect(decoded.packet.clientId).toBe(123);
      expect(decoded.packet.serverVersion).toBe('0.203.999');
      expect(decoded.packet.extraReason).toBe('auth failed');
    }
  });
});

