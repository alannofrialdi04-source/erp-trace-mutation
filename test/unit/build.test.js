'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { bangunSemua } = require('../../scripts/build');

const ROOT = path.resolve(__dirname, '..', '..');
const hasil = bangunSemua();
const tools = fs.readdirSync(path.join(ROOT, 'src', 'tools')).filter((f) => f.endsWith('.js'));

// Operasi tulis yang tidak boleh muncul di tool analisis (read-only)
const POLA_TULIS = [
  /\.insert(One|Many)?\s*\(/, /\.update(One|Many)?\s*\(/, /\.replaceOne\s*\(/, /\.delete(One|Many)\s*\(/,
  /\.remove\s*\(/, /\.drop(Database|Index|Indexes)?\s*\(/, /\.bulkWrite\s*\(/, /\.findOneAnd(Update|Replace|Delete)\s*\(/,
  /\.findAndModify\s*\(/, /\.createIndex(es)?\s*\(/, /\.renameCollection\s*\(/, /\.save\s*\(/, /['"]\$out['"]|\$out\s*:/,
  /['"]\$merge['"]|\$merge\s*:/,
];

test('setiap tool di src/tools menghasilkan satu file dist', () => {
  assert.deepEqual(Object.keys(hasil).sort(), tools.sort());
});

test('dist/ di repo sama persis dengan hasil build (jalankan `npm run build` bila gagal)', () => {
  for (const [f, isi] of Object.entries(hasil)) {
    const p = path.join(ROOT, 'dist', f);
    assert.ok(fs.existsSync(p), 'dist/' + f + ' belum ada');
    assert.equal(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'), isi, 'dist/' + f + ' tidak sesuai sumber');
  }
});

test('file dist valid secara sintaks dan bebas sisa kode Node', () => {
  for (const [f, isi] of Object.entries(hasil)) {
    assert.doesNotThrow(() => new vm.Script(isi, { filename: f }), f);
    assert.ok(!/\brequire\s*\(/.test(isi), f + ' masih mengandung require()');
    assert.ok(!/module\.exports/.test(isi), f + ' masih mengandung module.exports');
    assert.ok(!/#region/.test(isi), f + ' masih mengandung penanda region');
  }
});

test('tool analisis READ-ONLY: tidak ada operasi tulis', () => {
  for (const [f, isi] of Object.entries(hasil)) {
    for (const pola of POLA_TULIS) assert.ok(!pola.test(isi), f + ' mengandung operasi tulis: ' + pola);
  }
});

test('CONFIG bisa diedit di bagian atas file', () => {
  for (const [f, isi] of Object.entries(hasil)) {
    const posisiConfig = isi.indexOf('var CONFIG = {');
    const posisiLib = isi.indexOf('// ---- src/lib/');
    assert.ok(posisiConfig > 0 && posisiConfig < posisiLib, f + ': CONFIG harus berada sebelum lib');
  }
});
