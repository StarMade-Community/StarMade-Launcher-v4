import { describe, it, expect } from 'vitest';

import {
  decodeStarmotePacket,
  encodeAdminCommandPacket,
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
});

