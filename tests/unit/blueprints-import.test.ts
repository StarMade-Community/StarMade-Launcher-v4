import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';

import { importSmentToCatalog } from '../../electron/blueprints';

let catalog: string;
let scratch: string;

beforeEach(() => {
  catalog = fs.mkdtempSync(path.join(os.tmpdir(), 'sment-catalog-'));
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sment-src-'));
});
afterEach(() => {
  fs.rmSync(catalog, { recursive: true, force: true });
  fs.rmSync(scratch, { recursive: true, force: true });
});

/** Write a .sment (zip) containing the given entryName -> contents pairs. */
function makeSment(name: string, entries: Record<string, string>): string {
  const zip = new AdmZip();
  for (const [entryName, body] of Object.entries(entries)) {
    zip.addFile(entryName, Buffer.from(body));
  }
  const out = path.join(scratch, name);
  zip.writeZip(out);
  return out;
}

describe('importSmentToCatalog', () => {
  it('imports a wrapped .sment into blueprints/<wrapper>/ without double-nesting', () => {
    const sment = makeSment('Whatever.sment', {
      'My Ship/header.smbph': 'hdr',
      'My Ship/data.smbpm': 'dat',
    });

    const res = importSmentToCatalog(catalog, sment);

    expect(res.errors).toBeUndefined();
    expect(res.success).toBe(true);
    expect(fs.readFileSync(path.join(catalog, 'blueprints', 'My Ship', 'header.smbph'), 'utf8')).toBe('hdr');
    expect(fs.existsSync(path.join(catalog, 'blueprints', 'Whatever', 'My Ship'))).toBe(false);
  });

  it('nests a flat .sment under a folder named after the file', () => {
    const sment = makeSment('Flat Ship.sment', { 'header.smbph': 'hdr' });

    const res = importSmentToCatalog(catalog, sment);

    expect(res.success).toBe(true);
    expect(fs.readFileSync(path.join(catalog, 'blueprints', 'Flat Ship', 'header.smbph'), 'utf8')).toBe('hdr');
  });

  it('replaces an existing blueprint of the same name', () => {
    const first = makeSment('A.sment', { 'My Ship/header.smbph': 'old', 'My Ship/gone.smbpm': 'x' });
    importSmentToCatalog(catalog, first);
    const second = makeSment('B.sment', { 'My Ship/header.smbph': 'new' });

    importSmentToCatalog(catalog, second);

    const dir = path.join(catalog, 'blueprints', 'My Ship');
    expect(fs.readFileSync(path.join(dir, 'header.smbph'), 'utf8')).toBe('new');
    // Stale files from the previous import must not survive the replace.
    expect(fs.existsSync(path.join(dir, 'gone.smbpm'))).toBe(false);
  });

  it('leaves no staging directories behind', () => {
    importSmentToCatalog(catalog, makeSment('A.sment', { 'My Ship/header.smbph': 'hdr' }));
    importSmentToCatalog(catalog, makeSment('B.sment', { 'header.smbph': 'hdr' }));

    expect(fs.readdirSync(catalog).filter((e) => e.startsWith('.sment-import-'))).toEqual([]);
  });

  it('copies the original .sment into blueprints/exported/', () => {
    const sment = makeSment('Keep.sment', { 'My Ship/header.smbph': 'hdr' });

    importSmentToCatalog(catalog, sment);

    expect(fs.existsSync(path.join(catalog, 'blueprints', 'exported', 'Keep.sment'))).toBe(true);
  });
});
