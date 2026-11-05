'use strict';
/**
 * dist/00-cek-mapping.js dijalankan di mongosh terhadap data dummy berisi anomali tertanam.
 */
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helper');
const data = require('../fixtures/data-uji');
const mappingUji = require('../fixtures/mapping-uji');

const DB = 'erp_trace_uji_cek';
const salin = (o) => JSON.parse(JSON.stringify(o));

function cek(override, opsi) {
  const r = h.jalankanTool('00-cek-mapping', DB, Object.assign({ MAPPING: mappingUji, CONFIG: { FORMAT: 'json' } }, override), opsi);
  return h.ambilJSON(r.stdout).hasil;
}

const perSumber = (hasil) => Object.fromEntries(hasil.sumber.map((s) => [s.kunci, s]));
/** Temuan non-INFO: [kode, jumlah] diurutkan */
const masalah = (s) => s.temuan.filter((t) => t.level !== 'INFO').map((t) => [t.kode, t.jumlah === undefined ? null : t.jumlah]).sort();
const kodeTemuan = (s) => s.temuan.map((t) => t.kode);

before(() => {
  h.pastikanMongo();
  h.seed(DB, data);
});

test('menemukan persis anomali yang ditanam', () => {
  const hasil = cek();
  const s = perSumber(hasil);
  assert.deepEqual(hasil.ringkasan, { OK: 1, PERINGATAN: 3, ERROR: 0 });

  assert.equal(s.masuk.status, 'PERINGATAN');
  assert.deepEqual(masalah(s.masuk), [['KODE_SPASI', 1], ['QTY_STRING', 2]]);
  assert.deepEqual(s.masuk.statistik.tipeQty, { double: 2, int: 4, string: 2 });
  assert.deepEqual(s.masuk.statistik.companyCode, { PT1: 7, PT2: 1 });
  assert.equal(s.masuk.statistik.jamLokal['00:00'], 6);

  assert.equal(s.keluar.status, 'PERINGATAN');
  assert.deepEqual(masalah(s.keluar), [['QTY_NEGATIF', 1], ['TANGGAL_MASA_DEPAN', 1]]);

  assert.equal(s.koreksi.status, 'OK');
  assert.deepEqual(masalah(s.koreksi), []);
  assert.deepEqual(s.koreksi.statistik.arah, { IN: 1, OUT: 1 });

  assert.equal(s.penyesuaian.status, 'PERINGATAN');
  assert.deepEqual(masalah(s.penyesuaian), [['ARAH_TIDAK_DIKENAL', 1], ['DETAIL_YATIM', 1]]);
  assert.deepEqual(s.penyesuaian.statistik.arahTidakDikenal, { KOREKSI: 1 });
});

test('filter PERIODE + COMPANY_CODE: data di luar periode tidak ikut dicek', () => {
  const hasil = cek({ CONFIG: { FORMAT: 'json', PERIODE: '2025-11', COMPANY_CODE: 'PT1' } });
  const s = perSumber(hasil);
  assert.equal(hasil.periode, '2025-11-01 s/d 2025-11-30 (WIB)');
  assert.equal(s.masuk.statistik.sampel, 6);
  // Batas WIB: 00:00 WIB 1 Nov (17:00Z 31 Okt) ikut, 00:00 WIB 1 Des (17:00Z 30 Nov) tidak ikut
  assert.equal(s.masuk.statistik.tanggalMin, '2025-10-31T17:00:00.000Z');
  assert.equal(s.masuk.statistik.tanggalMax, '2025-11-30T16:59:59.000Z');
  assert.deepEqual(masalah(s.keluar), [['QTY_NEGATIF', 1]], 'dokumen 2099 di luar periode');
  assert.ok(kodeTemuan(s.penyesuaian).includes('INFO_FILTER_HEADER'));
  assert.deepEqual(masalah(s.penyesuaian), [['ARAH_TIDAK_DIKENAL', 1]], 'detail yatim tidak punya tanggal header');
});

test('nama field salah -> ERROR field wajib kosong semua', () => {
  const m = salin(mappingUji);
  m.sumber.masuk.field.qty = 'qtyy';
  const s = perSumber(cek({ MAPPING: m, CONFIG: { FORMAT: 'json', SUMBER: ['masuk'] } }));
  assert.equal(s.masuk.status, 'ERROR');
  assert.ok(kodeTemuan(s.masuk).includes('FIELD_WAJIB_KOSONG_SEMUA'));
});

test('link header beda tipe tanpa konversi -> ERROR + saran toObjectId', () => {
  const m = salin(mappingUji);
  delete m.sumber.penyesuaian.header.konversi;
  const s = perSumber(cek({ MAPPING: m, CONFIG: { FORMAT: 'json', SUMBER: ['penyesuaian'] } }));
  assert.equal(s.penyesuaian.status, 'ERROR');
  const t = s.penyesuaian.temuan.find((x) => x.kode === 'HEADER_TIDAK_TERHUBUNG');
  assert.ok(t, 'temuan HEADER_TIDAK_TERHUBUNG ada');
  assert.match(t.pesan, /konversi: "toObjectId"/);
});

test('koleksi tidak ada -> ERROR + kandidat nama', () => {
  const m = salin(mappingUji);
  m.sumber.masuk.koleksi = 'uji_IncomingDetail';
  const s = perSumber(cek({ MAPPING: m, CONFIG: { FORMAT: 'json', SUMBER: ['masuk'] } }));
  assert.equal(s.masuk.status, 'ERROR');
  const t = s.masuk.temuan.find((x) => x.kode === 'KOLEKSI_TIDAK_ADA');
  assert.match(t.pesan, /Mungkin maksudnya: uji_incomingdetail/);
  assert.equal(s.masuk.statistik, null);
});

test('error validasi per sumber -> sumber itu tidak dijalankan, sumber lain tetap dicek', () => {
  const m = salin(mappingUji);
  m.sumber.masuk.arah = 'MASUK';
  const hasil = cek({ MAPPING: m });
  const s = perSumber(hasil);
  assert.equal(s.masuk.status, 'ERROR');
  assert.deepEqual(kodeTemuan(s.masuk), ['VALIDASI']);
  assert.equal(s.masuk.statistik, null);
  assert.equal(s.koreksi.status, 'OK');
});

test('error validasi global (timezone) -> tidak ada sumber yang dijalankan', () => {
  const m = salin(mappingUji);
  m.timezone = '+7';
  const hasil = cek({ MAPPING: m });
  assert.equal(hasil.errorGlobal.length, 1);
  assert.deepEqual(hasil.sumber, []);
});

test('CONFIG salah -> gagal dengan pesan jelas', () => {
  const r1 = h.jalankanTool('00-cek-mapping', DB, { MAPPING: mappingUji, CONFIG: { SUMBER: ['tidakAda'] } }, { bolehGagal: true });
  assert.notEqual(r1.kode, 0);
  assert.match(r1.stdout + r1.stderr, /Sumber "tidakAda" tidak ada di MAPPING/);

  const r2 = h.jalankanTool('00-cek-mapping', DB, { MAPPING: mappingUji, CONFIG: { SAMPEL: 0 } }, { bolehGagal: true });
  assert.notEqual(r2.kode, 0);
  assert.match(r2.stdout + r2.stderr, /CONFIG\.SAMPEL harus bilangan bulat/);
});

test('format teks: ringkasan & status per sumber tampil', () => {
  const r = h.jalankanTool('00-cek-mapping', DB, { MAPPING: mappingUji });
  assert.match(r.stdout, /\[PERINGATAN\] masuk \| Incoming \(uji\)/);
  assert.match(r.stdout, /\[OK\]\s+koreksi/);
  assert.match(r.stdout, /Ringkasan: 1 OK \| 3 PERINGATAN \| 0 ERROR/);
});
