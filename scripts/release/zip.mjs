// Deterministic stored ZIP (no executable or platform-specific archiver).
import { readAllowed, listFiles } from "./prepare.mjs";
const crc32 = bytes => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};
export async function zipDirectory(root) {
  const names = await listFiles(root);
  if (names.length > 65535) throw new Error("ZIP64 not supported.");
  const chunks = [], central = [];
  let offset = 0;
  for (const path of names) {
    const name = Buffer.from(path), bytes = await readAllowed(root, path);
    if (bytes.length > 0xffffffff || offset + bytes.length > 0xffffffff) throw new Error("ZIP64 not supported.");
    const crc = crc32(bytes), header = Buffer.alloc(30), entry = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(name.length, 26);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8); entry.writeUInt16LE(33, 14);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(bytes.length, 20);
    entry.writeUInt32LE(bytes.length, 24); entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    chunks.push(header, name, bytes); central.push(entry, name);
    offset += header.length + name.length + bytes.length;
  }
  const index = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(names.length, 8); end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, index, end]);
}
