'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validasiMapping, daftarKoleksiMapping, lokasiField, ringkasArah } = require('../../src/lib/mapping');

const salin = (o) => JSON.parse(JSON.stringify(o));
const pathError = (hasil) => hasil.error.map((e) => e.path);

test('config/mapping.js (placeholder) valid secara struktur', () => {
  const hasil = validasiMapping(require('../../config/mapping'));
  assert.deepEqual(hasil.error, []);
  assert.deepEqual(hasil.peringatan, []);
});

test('mapping uji valid', () => {
  const hasil = validasiMapping(require('../fixtures/mapping-uji'));
  assert.deepEqual(hasil.error, []);
});

test('daftar koleksi mencakup header, tanpa duplikat', () => {
  const daftar = daftarKoleksiMapping(require('../../config/mapping'));
  assert.equal(daftar.length, 9);
  assert.ok(daftar.includes('tbl_stokpenyesuaianheader'));
});

test('field wajib yang belum dipetakan -> error', () => {
  const m = salin(require('../fixtures/mapping-uji'));
  delete m.sumber.masuk.field.qty;
  assert.deepEqual(pathError(validasiMapping(m)), ['sumber.masuk.field.qty']);
});

test('field dipetakan di detail dan header sekaligus -> error', () => {
  const m = salin(require('../fixtures/mapping-uji'));
  m.sumber.penyesuaian.field.tanggal = 'tanggal';
  assert.deepEqual(pathError(validasiMapping(m)), ['sumber.penyesuaian.header.field.tanggal']);
});

test('arah tidak valid & nilai arah bentrok -> error', () => {
  const m = salin(require('../fixtures/mapping-uji'));
  m.sumber.masuk.arah = 'MASUK';
  m.sumber.penyesuaian.arah.nilai = { TAMBAH: 'IN', ' tambah ': 'OUT' };
  assert.deepEqual(pathError(validasiMapping(m)), ['sumber.masuk.arah', 'sumber.penyesuaian.arah.nilai']);
});

test('header tidak lengkap & konversi salah -> error', () => {
  const m = salin(require('../fixtures/mapping-uji'));
  delete m.sumber.penyesuaian.header.localField;
  m.sumber.penyesuaian.header.konversi = 'ObjectId';
  assert.deepEqual(pathError(validasiMapping(m)), [
    'sumber.penyesuaian.header.localField',
    'sumber.penyesuaian.header.konversi',
  ]);
});

test('salah ketik nama field logis / properti -> peringatan, bukan error', () => {
  const m = salin(require('../fixtures/mapping-uji'));
  m.sumber.masuk.field.kodebarang = 'x';
  m.sumber.masuk.feild = {};
  const hasil = validasiMapping(m);
  assert.deepEqual(hasil.error, []);
  assert.deepEqual(hasil.peringatan.map((p) => p.path), ['sumber.masuk.feild', 'sumber.masuk.field.kodebarang']);
});

test('nama field dengan awalan $ & timezone salah -> error', () => {
  const m = salin(require('../fixtures/mapping-uji'));
  m.sumber.masuk.field.qty = '$qty';
  m.timezone = '+7';
  assert.deepEqual(pathError(validasiMapping(m)), ['timezone', 'sumber.masuk.field.qty']);
});

test('mapping kosong -> error', () => {
  assert.deepEqual(pathError(validasiMapping(null)), ['mapping']);
  assert.deepEqual(pathError(validasiMapping({ meta: { status: 'ASUMSI' }, sumber: {} })), ['sumber']);
});

test('lokasiField & ringkasArah', () => {
  const m = require('../fixtures/mapping-uji');
  assert.deepEqual(lokasiField(m.sumber.penyesuaian, 'tanggal'), { lokasi: 'header', path: 'tanggal' });
  assert.deepEqual(lokasiField(m.sumber.keluar, 'kodeBarang'), { lokasi: 'detail', path: 'kodeMaterial' });
  assert.equal(lokasiField(m.sumber.masuk, 'gudang'), null);
  assert.equal(ringkasArah('IN'), 'IN');
  assert.equal(ringkasArah(m.sumber.penyesuaian.arah), 'dari field jenis (TAMBAH->IN, KURANG->OUT)');
});
