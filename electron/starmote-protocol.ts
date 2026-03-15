const PROTOCOL_MAGIC = 'SM4T';

export const STARMOTE_PROTOCOL_VERSION = 1;

export const STARMOTE_COMMAND_IDS = {
  ADMIN_COMMAND: 0x0101,
} as const;

export interface StarmoteDecodedPacket {
  version: number;
  commandId: number;
  payload: Uint8Array;
}

export function encodeStarmotePacket(commandId: number, payload: Uint8Array): Uint8Array {
  const headerSize = 11;
  const frame = Buffer.allocUnsafe(headerSize + payload.byteLength);
  frame.write(PROTOCOL_MAGIC, 0, 'ascii');
  frame.writeUInt8(STARMOTE_PROTOCOL_VERSION, 4);
  frame.writeUInt16BE(commandId & 0xffff, 5);
  frame.writeUInt32BE(payload.byteLength >>> 0, 7);
  Buffer.from(payload).copy(frame, headerSize);
  return frame;
}

export function encodeAdminCommandPacket(command: string): Uint8Array {
  const payload = Buffer.from(command, 'utf8');
  return encodeStarmotePacket(STARMOTE_COMMAND_IDS.ADMIN_COMMAND, payload);
}

export function decodeStarmotePacket(frame: Uint8Array):
  | { ok: true; packet: StarmoteDecodedPacket }
  | { ok: false; error: string } {
  const data = Buffer.from(frame);
  if (data.byteLength < 11) {
    return { ok: false, error: 'Frame too short for StarMote header.' };
  }

  const magic = data.toString('ascii', 0, 4);
  if (magic !== PROTOCOL_MAGIC) {
    return { ok: false, error: `Unexpected frame magic "${magic}".` };
  }

  const version = data.readUInt8(4);
  const commandId = data.readUInt16BE(5);
  const payloadLength = data.readUInt32BE(7);

  if (payloadLength > data.byteLength - 11) {
    return { ok: false, error: 'Truncated frame payload.' };
  }

  const payload = data.subarray(11, 11 + payloadLength);
  return {
    ok: true,
    packet: { version, commandId, payload },
  };
}
