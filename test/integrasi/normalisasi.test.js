'use strict';
/**
 * Pipeline normalisasi (src/lib/sumber.js) dijalankan ke MongoDB sungguhan.
 */
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helper');
const data = require('../fixtures/data-uji');
const mapping = require('../fixtures/mapping-uji');
const { keEJSON } = require('../fixtures/ejson');
const { bangunPipelineSumber } = require('../../src/lib/sumber');
const { rentangPeriode } = require('../../src/lib/tanggal');

const DB = 'erp_trace_uji_normalisasi';
const NOV_2025 = rentangPeriode('2025-11', '+07:00');

/** EJSON relaxed -> nilai sederhana ({$date} -> ISO string, {$oid} -> hex) */
function rapikan(v) {
  if (Array.isArray(v)) return v.map(rapikan);
  if (v && typeof v === 'object') {
    if (v.$date !== undefined) return new Date(v.$date).toISOString();
    if (v.$oid !== undefined) return v.$oid;
    const o = {};
    for (const k of Object.keys(v)) o[k] = rapikan(v[k]);
    return o;
  }
  return v;
}

function jalankanSumber(kunci, opsi) {
  const s = mapping.sumber[kunci];
  const pipeline = keEJSON(bangunPipelineSumber(kunci, s, opsi));
  const script = [
    'var P = EJSON.parse(' + JSON.stringify(JSON.stringify(pipeline)) + ');',
    "print('__TRACE_JSON_BEGIN__');",
    'print(EJSON.stringify(db.getCollection(' + JSON.stringify(s.koleksi) + ').aggregate(P).toArray(), { relaxed: true }));',
    "print('__TRACE_JSON_END__');",
  ].join('\n');
  const baris = rapikan(h.ambilJSON(h.jalankanMongosh(script, DB).stdout));
  return baris.sort((a, b) => (a.docId < b.docId ? -1 : 1));
}

const akhiran = (docId) => Number(docId.slice(-2));

before(() => {
  h.pastikanMongo();
  h.seed(DB, data);
});

test('masuk: filter periode WIB + companyCode, batas 23:59:59 masuk, 00:00 bulan berikut keluar', () => {
  const baris = jalankanSumber('masuk', { filter: { companyCode: 'PT1', tanggal: { gte: NOV_2025.gte, lt: NOV_2025.lt } } });
  assert.deepEqual(baris.map((b) => akhiran(b.docId)), [1, 2, 3, 4, 5, 6]);

  const per = Object.fromEntries(baris.map((b) => [akhiran(b.docId), b]));
  assert.equal(per[1].qty, 100);
  assert.equal(per[1].qtyTipe, 'double');
  assert.equal(per[1].arah, 'IN');
  assert.equal(per[1].kategori, 'BB');
  assert.equal(per[1].sumber, 'masuk');
  assert.equal(per[1].noAju, '000001');
  assert.equal(per[1].tanggal, '2025-10-31T17:00:00.000Z');
  assert.equal(per[2].qtyTipe, 'int');
  assert.equal(per[3].qty, 75, 'qty string "75" dikonversi ke angka');
  assert.equal(per[3].qtyTipe, 'string');
  assert.equal(per[4].qty, null, 'qty "1.234,5" tidak bisa dikonversi');
  assert.equal(per[4].qtyAsli, '1.234,5');
  assert.equal(per[5].kodeBarang, 'BB-001', 'kodeBarang di-trim');
  assert.equal(per[5].kodeBarangAsli, 'BB-001 ');
  assert.equal(per[6].tanggal, '2025-11-30T16:59:59.000Z');
  assert.equal(per[6].idAsal, null, 'field opsional yang tidak dipetakan = null');

  const total = baris.reduce((s, b) => s + (b.qty || 0), 0);
  assert.equal(total, 255.5);
});

test('keluar: nama field fisik berbeda (tglKeluar, kodeMaterial, jumlah) tetap jadi bentuk seragam', () => {
  const baris = jalankanSumber('keluar', { filter: { kodeBarang: 'BB-002' } });
  assert.deepEqual(baris.map((b) => [akhiran(b.docId), b.kodeBarang, b.qty, b.arah]), [
    [2, 'BB-002', -5, 'OUT'],
    [3, 'BB-002', 1, 'OUT'],
  ]);
  assert.equal(baris[0].idAsal, '65a000000000000000000002');
});

test('penyesuaian: tanggal & companyCode dari header, arah dari field jenis', () => {
  const baris = jalankanSumber('penyesuaian', { filter: { companyCode: 'PT1', tanggal: { gte: NOV_2025.gte, lt: NOV_2025.lt } } });
  assert.deepEqual(baris.map((b) => [akhiran(b.docId), b.arah, b.arahAsli, b.qty]), [
    [1, 'IN', 'TAMBAH', 3],
    [2, 'OUT', ' kurang ', 2],
    [3, 'TIDAK_DIKENAL', 'KOREKSI', 1],
  ]);
  assert.equal(baris[0].tanggal, '2025-11-07T17:00:00.000Z');
  assert.equal(baris[0].companyCode, 'PT1');
  assert.equal(baris[0].noTransaksi, 'ADJ/2025/11/001');
  assert.equal(baris[0].headerJumlah, 1);
  assert.equal(baris[0].linkTipe, 'string');
});

test('penyesuaian tanpa filter: detail yatim tetap muncul dengan headerJumlah 0', () => {
  const baris = jalankanSumber('penyesuaian', {});
  assert.equal(baris.length, 4);
  const yatim = baris.find((b) => akhiran(b.docId) === 4);
  assert.equal(yatim.headerJumlah, 0);
  assert.equal(yatim.tanggal, null);
  assert.equal(yatim.companyCode, null);
  assert.equal(yatim.arah, 'IN');
});

test('koreksi TANDA_QTY: qty positif = IN, negatif = OUT (nilai absolut)', () => {
  const baris = jalankanSumber('koreksi', {});
  assert.deepEqual(baris.map((b) => [b.arah, b.qty]), [['IN', 10], ['OUT', 4]]);
});
