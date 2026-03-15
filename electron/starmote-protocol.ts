const PROTOCOL_MAGIC = 'SM4T';
const LENGTH_PREFIX_BYTES = 4;
const PACKET_BODY_HEADER_BYTES = 7;

const SCHINE_PACKET_BYTE = 42;
const SCHINE_TYPE_PARAMETRIZED_COMMAND = 111;
const SCHINE_TYPE_STRING = 4;
const EXECUTE_ADMIN_COMMAND_ID = 2;

export const STARMOTE_PROTOCOL_VERSION = 1;

export type StarmoteWireMode = 'length-prefixed' | 'legacy-sm4t';

export const STARMOTE_COMMAND_IDS = {
  ADMIN_COMMAND: 0x0101,
} as const;

export interface StarmoteDecodedPacket {
  version: number;
  commandId: number;
  payload: Uint8Array;
}

export interface ExecuteAdminCommandReturnPacket {
  commandId: number;
  stringParams: string[];
}

function encodeJavaUtfString(value: string): Buffer {
  const utfBytes = Buffer.from(value, 'utf8');
  if (utfBytes.byteLength > 0xffff) {
    throw new Error('String too long for Java writeUTF payload.');
  }

  const out = Buffer.allocUnsafe(2 + utfBytes.byteLength);
  out.writeUInt16BE(utfBytes.byteLength, 0);
  utfBytes.copy(out, 2);
  return out;
}

function decodeJavaUtfString(data: Buffer, offset: number):
  | { ok: true; value: string; nextOffset: number }
  | { ok: false; error: string } {
  if (offset + 2 > data.byteLength) {
    return { ok: false, error: 'Missing Java UTF length prefix.' };
  }

  const byteLength = data.readUInt16BE(offset);
  const start = offset + 2;
  const end = start + byteLength;
  if (end > data.byteLength) {
    return { ok: false, error: 'Truncated Java UTF payload.' };
  }

  return {
    ok: true,
    value: data.subarray(start, end).toString('utf8'),
    nextOffset: end,
  };
}

export function encodeExecuteAdminCommandSuperPacket(command: string, serverPassword = ''): Uint8Array {
  const passwordUtf = encodeJavaUtfString(serverPassword);
  const commandUtf = encodeJavaUtfString(command);

  const payloadSize = 5 + 4 + 2 + passwordUtf.byteLength + commandUtf.byteLength;
  const payload = Buffer.allocUnsafe(payloadSize);

  let offset = 0;
  payload.writeInt8(SCHINE_PACKET_BYTE, offset);
  offset += 1;
  payload.writeInt16BE(-1, offset);
  offset += 2;
  payload.writeUInt8(EXECUTE_ADMIN_COMMAND_ID, offset);
  offset += 1;
  payload.writeUInt8(SCHINE_TYPE_PARAMETRIZED_COMMAND, offset);
  offset += 1;

  payload.writeInt32BE(2, offset);
  offset += 4;

  payload.writeUInt8(SCHINE_TYPE_STRING, offset);
  offset += 1;
  passwordUtf.copy(payload, offset);
  offset += passwordUtf.byteLength;

  payload.writeUInt8(SCHINE_TYPE_STRING, offset);
  offset += 1;
  commandUtf.copy(payload, offset);

  const frame = Buffer.allocUnsafe(LENGTH_PREFIX_BYTES + payload.byteLength);
  frame.writeUInt32BE(payload.byteLength, 0);
  payload.copy(frame, LENGTH_PREFIX_BYTES);
  return frame;
}

export function decodeExecuteAdminCommandReturnPacket(frame: Uint8Array):
  | { ok: true; packet: ExecuteAdminCommandReturnPacket }
  | { ok: false; error: string } {
  const data = Buffer.from(frame);
  if (data.byteLength < LENGTH_PREFIX_BYTES + 9) {
    return { ok: false, error: 'Frame too short for ExecuteAdminCommand header.' };
  }

  const declaredPayloadLength = data.readUInt32BE(0);
  if (declaredPayloadLength !== data.byteLength - LENGTH_PREFIX_BYTES) {
    return { ok: false, error: 'Length-prefixed frame length mismatch.' };
  }

  const payload = data.subarray(LENGTH_PREFIX_BYTES);
  if (payload.readUInt8(0) !== SCHINE_PACKET_BYTE) {
    return { ok: false, error: 'Not a Schine super-packet frame.' };
  }

  const commandId = payload.readUInt8(3);
  if (commandId !== EXECUTE_ADMIN_COMMAND_ID) {
    return { ok: false, error: 'Not an ExecuteAdminCommand packet.' };
  }

  const packetType = payload.readUInt8(4);
  if (packetType !== SCHINE_TYPE_PARAMETRIZED_COMMAND) {
    return { ok: false, error: 'Unexpected ExecuteAdminCommand packet type.' };
  }

  const parameterCount = payload.readInt32BE(5);
  if (parameterCount < 0 || parameterCount > 128) {
    return { ok: false, error: 'ExecuteAdminCommand parameter count is invalid.' };
  }

  let offset = 9;
  const stringParams: string[] = [];
  for (let index = 0; index < parameterCount; index += 1) {
    if (offset >= payload.byteLength) {
      return { ok: false, error: 'ExecuteAdminCommand parameter list is truncated.' };
    }

    const parameterType = payload.readUInt8(offset);
    offset += 1;
    if (parameterType !== SCHINE_TYPE_STRING) {
      return { ok: false, error: `Unsupported ExecuteAdminCommand parameter type: ${parameterType}` };
    }

    const decodedString = decodeJavaUtfString(payload, offset);
    if (decodedString.ok === false) {
      return { ok: false, error: decodedString.error };
    }

    offset = decodedString.nextOffset;
    stringParams.push(decodedString.value);
  }

  if (offset !== payload.byteLength) {
    return { ok: false, error: 'Unexpected trailing bytes in ExecuteAdminCommand payload.' };
  }

  return {
    ok: true,
    packet: {
      commandId,
      stringParams,
    },
  };
}

function encodePacketBody(commandId: number, payload: Uint8Array): Buffer {
  const body = Buffer.allocUnsafe(PACKET_BODY_HEADER_BYTES + payload.byteLength);
  body.writeUInt8(STARMOTE_PROTOCOL_VERSION, 0);
  body.writeUInt16BE(commandId & 0xffff, 1);
  body.writeUInt32BE(payload.byteLength >>> 0, 3);
  Buffer.from(payload).copy(body, PACKET_BODY_HEADER_BYTES);
  return body;
}

export function encodeStarmotePacket(
  commandId: number,
  payload: Uint8Array,
  mode: StarmoteWireMode = 'length-prefixed',
): Uint8Array {
  const body = encodePacketBody(commandId, payload);

  if (mode === 'legacy-sm4t') {
    const frame = Buffer.allocUnsafe(4 + body.byteLength);
    frame.write(PROTOCOL_MAGIC, 0, 'ascii');
    body.copy(frame, 4);
    return frame;
  }

  const frame = Buffer.allocUnsafe(LENGTH_PREFIX_BYTES + body.byteLength);
  frame.writeUInt32BE(body.byteLength >>> 0, 0);
  body.copy(frame, LENGTH_PREFIX_BYTES);
  return frame;
}

export function encodeAdminCommandPacket(command: string, mode: StarmoteWireMode = 'length-prefixed'): Uint8Array {
  const payload = Buffer.from(command, 'utf8');
  return encodeStarmotePacket(STARMOTE_COMMAND_IDS.ADMIN_COMMAND, payload, mode);
}

export function decodeStarmotePacket(frame: Uint8Array):
  | { ok: true; packet: StarmoteDecodedPacket }
  | { ok: false; error: string } {
  const data = Buffer.from(frame);
  if (data.byteLength < PACKET_BODY_HEADER_BYTES + LENGTH_PREFIX_BYTES) {
    return { ok: false, error: 'Frame too short for StarMote header.' };
  }

  if (data.toString('ascii', 0, 4) === PROTOCOL_MAGIC) {
    return decodePacketBody(data.subarray(4));
  }

  const declaredBodyLength = data.readUInt32BE(0);
  if (declaredBodyLength !== data.byteLength - LENGTH_PREFIX_BYTES) {
    return { ok: false, error: 'Length-prefixed frame length mismatch.' };
  }

  return decodePacketBody(data.subarray(LENGTH_PREFIX_BYTES));
}

function decodePacketBody(body: Buffer):
  | { ok: true; packet: StarmoteDecodedPacket }
  | { ok: false; error: string } {
  if (body.byteLength < PACKET_BODY_HEADER_BYTES) {
    return { ok: false, error: 'Packet body too short.' };
  }

  const version = body.readUInt8(0);
  const commandId = body.readUInt16BE(1);
  const payloadLength = body.readUInt32BE(3);

  if (payloadLength > body.byteLength - PACKET_BODY_HEADER_BYTES) {
    return { ok: false, error: 'Truncated frame payload.' };
  }

  const payload = body.subarray(PACKET_BODY_HEADER_BYTES, PACKET_BODY_HEADER_BYTES + payloadLength);
  return {
    ok: true,
    packet: { version, commandId, payload },
  };
}
