'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validasiMapping, daftarKoleksiMapping, lokasiField, ringkasArah, sumberRujukan } = require('../../src/lib/mapping');

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

test('daftar koleksi mencakup header & master, tanpa duplikat', () => {
  const daftar = daftarKoleksiMapping(require('../../config/mapping'));
  assert.equal(daftar.length, 11);
  assert.equal(new Set(daftar).size, daftar.length);
  assert.ok(daftar.includes('tbl_stok'));
  assert.ok(daftar.includes('tbl_barang'), 'koleksi master ikut');
  assert.ok(daftarKoleksiMapping(require('../fixtures/mapping-uji')).includes('uji_penyesuaianheader'), 'koleksi header ikut');
});

test('rujukan ledger: sumber tujuan harus ada, butuh idAsal & asal', () => {
  const m = salin(require('../../config/mapping'));
  m.sumber.stok.rujukan.INCOMING = 'tidakAda';
  m.sumber.stok.rujukan.STOK = 'stok';
  assert.deepEqual(pathError(validasiMapping(m)), ['sumber.stok.rujukan.INCOMING', 'sumber.stok.rujukan.STOK']);
  const m2 = salin(require('../../config/mapping'));
  delete m2.sumber.stok.field.idAsal;
  assert.deepEqual(pathError(validasiMapping(m2)), ['sumber.stok.rujukan']);
});

test('master: kodeBarang wajib, field tak dikenal jadi peringatan', () => {
  const m = salin(require('../../config/mapping'));
  delete m.master.field.kodeBarang;
  m.master.field.warna = 'color';
  const hasil = validasiMapping(m);
  assert.deepEqual(hasil.error.map((e) => e.path), ['master.field.kodeBarang']);
  assert.deepEqual(hasil.peringatan.map((p) => p.path), ['master.field.warna']);
});

test('properti level atas yang salah ketik -> peringatan', () => {
  const m = salin(require('../../config/mapping'));
  m.mastr = {};
  assert.deepEqual(validasiMapping(m).peringatan.map((p) => p.path), ['mapping.mastr']);
});

test('opname: kodeBarang/qty/tanggal wajib', () => {
  const m = salin(require('../../config/mapping'));
  delete m.opname.monsus.field.qty;
  m.opname.monsus.field.lokasi = 'x';
  const hasil = validasiMapping(m);
  assert.deepEqual(hasil.error.map((e) => e.path), ['opname.monsus.field.qty']);
  assert.deepEqual(hasil.peringatan.map((p) => p.path), ['opname.monsus.field.lokasi']);
  const m2 = salin(require('../../config/mapping'));
  m2.opname = {};
  assert.deepEqual(pathError(validasiMapping(m2)), ['opname']);
});

test('sumberRujukan: kunci ASAL:ARAH didahulukan', () => {
  const s = require('../../config/mapping').sumber.stok;
  assert.equal(sumberRujukan(s, 'DEADSTOK', 'OUT'), 'deadstokKeluar');
  assert.equal(sumberRujukan(s, 'DEADSTOK', 'IN'), 'deadstokMasuk');
  assert.equal(sumberRujukan(s, 'INCOMING', 'IN'), 'incoming');
  assert.equal(sumberRujukan(s, 'LAIN', 'IN'), null);
  assert.equal(sumberRujukan(s, null, 'IN'), null);
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
