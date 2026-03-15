import { describe, it, expect } from 'vitest';

import {
  decodeStarmotePacket,
  encodeAdminCommandPacket,
  encodeExecuteAdminCommandSuperPacket,
  encodeStarmotePacket,
  STARMOTE_COMMAND_IDS,
  STARMOTE_PROTOCOL_VERSION,
} from '../../electron/starmote-protocol.js';

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
});

