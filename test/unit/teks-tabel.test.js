'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { polaString, punyaSpasiTepi, kandidatNama, jarakLevenshtein, teratas } = require('../../src/lib/teks');
const { fmtAngka, fmtPersen, formatTabel } = require('../../src/lib/tabel');
const { tipeNilai, keJSONAman, angkaDariNilai } = require('../../src/lib/bson');

test('polaString menyamarkan nilai tapi mempertahankan bentuk', () => {
  assert.equal(polaString('PT-ABC/2024/001'), 'AA-AAA/9999/999');
  assert.equal(polaString('BB-001 '), 'AA-999 ');
  assert.equal(polaString('1.234,5'), '9.999,9');
  assert.equal(polaString('64b000000000000000000001'), '<hex24>');
  assert.equal(polaString('123e4567-e89b-12d3-a456-426614174000'), '<uuid>');
  assert.equal(polaString(''), '<kosong>');
  assert.equal(polaString('   '), '<spasi>');
  assert.equal(polaString('abcdefghij', 4), 'aaaa...(10 karakter)');
});

test('punyaSpasiTepi', () => {
  assert.equal(punyaSpasiTepi(' A'), true);
  assert.equal(punyaSpasiTepi('A '), true);
  assert.equal(punyaSpasiTepi('A B'), false);
  assert.equal(punyaSpasiTepi(''), false);
  assert.equal(punyaSpasiTepi(5), false);
});

test('kandidatNama menemukan nama koleksi yang mirip', () => {
  const semua = ['tbl_incomingdetail', 'tbl_incoming', 'tbl_deliverydetail', 'log_audit'];
  assert.deepEqual(kandidatNama('tbl_IncomingDetail', semua), ['tbl_incomingdetail', 'tbl_incoming']);
  assert.deepEqual(kandidatNama('tbl_deliverydetial', semua), ['tbl_deliverydetail']);
  assert.deepEqual(kandidatNama('xyz', semua), []);
  assert.equal(jarakLevenshtein('kitten', 'sitting'), 3);
});

test('teratas mengurutkan hitungan menurun lalu alfabet', () => {
  assert.deepEqual(teratas({ b: 2, a: 2, c: 5 }, 2), [{ nilai: 'c', jumlah: 5 }, { nilai: 'a', jumlah: 2 }]);
});

test('format angka & persen gaya Indonesia', () => {
  assert.equal(fmtAngka(1234567), '1.234.567');
  assert.equal(fmtAngka(1234.5, 2), '1.234,50');
  assert.equal(fmtAngka(-1234.5, 'auto'), '-1.234,5');
  assert.equal(fmtAngka(100, 'auto'), '100');
  assert.equal(fmtAngka(-0.00001, 'auto'), '0');
  assert.equal(fmtAngka(null), '-');
  assert.equal(fmtPersen(1, 8), '12,5%');
  assert.equal(fmtPersen(8, 8), '100%');
  assert.equal(fmtPersen(0, 8), '0%');
  assert.equal(fmtPersen(1, 3), '33,3%');
  assert.equal(fmtPersen(1, 0), '-');
});

test('formatTabel meratakan kolom, kolom terakhir tidak di-pad', () => {
  const baris = formatTabel(
    [{ judul: 'FIELD', kunci: 'f' }, { judul: 'ADA', kunci: 'a', kanan: true }, { judul: 'INFO', kunci: 'i' }],
    [{ f: 'qty', a: '100%', i: 'x' }, { f: 'tanggal', a: '5%', i: '' }]
  );
  assert.deepEqual(baris, [
    'FIELD     ADA  INFO',
    '-------  ----  ----',
    'qty      100%  x',
    'tanggal    5%',
  ]);
});

test('tipeNilai & keJSONAman untuk nilai JS biasa', () => {
  assert.equal(tipeNilai(undefined), 'missing');
  assert.equal(tipeNilai(null), 'null');
  assert.equal(tipeNilai(new Date()), 'date');
  assert.equal(tipeNilai([1]), 'array');
  assert.equal(tipeNilai(1.5), 'int/double');
  assert.equal(tipeNilai(true), 'bool');
  assert.equal(tipeNilai({ a: 1 }), 'object');
  assert.equal(tipeNilai({ _bsontype: 'Decimal128' }), 'decimal');
  assert.equal(angkaDariNilai(5), 5);
  assert.equal(angkaDariNilai('5'), null);
  assert.deepEqual(keJSONAman({ d: new Date('2026-01-01T00:00:00Z'), x: undefined, n: [1, null] }), {
    d: '2026-01-01T00:00:00.000Z',
    x: null,
    n: [1, null],
  });
});
