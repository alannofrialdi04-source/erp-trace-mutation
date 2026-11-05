'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../../src/lib/mutasi');
const { rentangPeriode } = require('../../src/lib/tanggal');
const mapping = require('../../config/mapping');

const g = (kode, satuan, asal, arah, bucket, qty, dok, ekstra) =>
  Object.assign({ _id: { kode, satuan, asal, arah, bucket }, qty, dok, qtyKosong: 0, sebelumCutoff: 0 }, ekstra || {});

test('sumberDihitung: hanya sumber dengan hitungMutasi bukan false', () => {
  assert.deepEqual(m.sumberDihitung(mapping), ['stok']);
});

test('pipelineGabungan: satu sumber tanpa $unionWith, dua sumber dengan $unionWith', () => {
  const satu = m.pipelineGabungan(mapping, ['stok'], { companyCode: 'WAG' });
  assert.equal(satu.koleksi, 'tbl_stok');
  assert.ok(!JSON.stringify(satu.pipeline).includes('$unionWith'));
  const akhir = satu.pipeline[satu.pipeline.length - 1].$addFields;
  assert.ok(akhir.qtyBertanda && akhir.urutArah && akhir.asal);

  const m2 = JSON.parse(JSON.stringify(mapping));
  m2.sumber.incoming.hitungMutasi = true;
  const dua = m.pipelineGabungan(m2, m.sumberDihitung(m2), { companyCode: 'WAG' });
  const union = dua.pipeline.find((s) => s.$unionWith);
  assert.equal(union.$unionWith.coll, 'tbl_incomingdetail');
  assert.deepEqual(union.$unionWith.pipeline[0], { $match: { companyCode: 'WAG' } });
  assert.throws(() => m.pipelineGabungan(mapping, [], {}), /Tidak ada sumber yang dihitung/);
});

test('tahapRekap & tahapMinus memakai batas periode dan cut-off', () => {
  const r = rentangPeriode('2026-01');
  const cut = new Date('2025-08-17T17:00:00Z');
  const rekap = JSON.stringify(m.tahapRekap(r, cut));
  assert.ok(rekap.includes('"AWAL"') && rekap.includes('"PERIODE"') && rekap.includes('"SESUDAH"') && rekap.includes('"TANPA_TANGGAL"'));
  assert.ok(rekap.includes('2025-08-17T17:00:00.000Z'));
  assert.ok(!JSON.stringify(m.tahapRekap(r, null)).includes('2025-08-17'));
  const minus = m.tahapMinus(r);
  assert.ok(minus.some((s) => s.$setWindowFields && s.$setWindowFields.partitionBy === '$kodeBarang'));
});

test('pivotRekap: saldo awal/masuk/keluar/akhir, per asal, bucket khusus', () => {
  const hasil = m.pivotRekap([
    g('A', 'YRD', 'INCOMING', 'IN', 'AWAL', 100, 1),
    g('A', 'YRD', 'MATERIALOUT', 'OUT', 'AWAL', 30, 2, { sebelumCutoff: 1 }),
    g('A', 'YRD', 'INCOMING', 'IN', 'PERIODE', 50.1, 1),
    g('A', 'MTR', 'MATERIALOUT', 'OUT', 'PERIODE', 20.2, 3, { qtyKosong: 1 }),
    g('A', 'YRD', 'MATERIALOUT', 'OUT', 'SESUDAH', 5, 1),
    g('A', 'YRD', 'X', 'TIDAK_DIKENAL', 'PERIODE', 9, 1),
    g('A', 'YRD', 'X', 'IN', 'TANPA_TANGGAL', 9, 2),
    g(null, null, 'DELIVERY', 'OUT', 'PERIODE', 1, 1),
  ]);
  assert.equal(hasil.length, 2);
  const kosong = hasil.find((x) => x.kodeBarang === null);
  assert.equal(kosong.akhir, -1);
  const a = hasil.find((x) => x.kodeBarang === 'A');
  assert.deepEqual([a.awal, a.masuk, a.keluar, a.akhir], [70, 50.1, 20.2, 99.9]);
  assert.deepEqual(a.satuan, { YRD: 8, MTR: 3 }, 'semua dokumen kode ini dihitung per satuan');
  assert.deepEqual(a.perAsal, { INCOMING: { masuk: 50.1, keluar: 0, dok: 1 }, MATERIALOUT: { masuk: 0, keluar: 20.2, dok: 3 } });
  assert.equal(a.dokSesudah, 1);
  assert.equal(a.arahTidakDikenal, 1);
  assert.equal(a.tanpaTanggal, 2);
  assert.equal(a.qtyKosong, 1);
  assert.equal(a.sebelumCutoff, 1);
});

test('tandaiRekap & bobotTanda', () => {
  const dasar = { awal: 0, akhir: 5, satuan: { YRD: 1 }, sebelumCutoff: 0, arahTidakDikenal: 0, qtyKosong: 0, tanpaTanggal: 0 };
  assert.deepEqual(m.tandaiRekap(dasar, { master: {}, cekMaster: true, minus: null }), []);
  assert.deepEqual(m.tandaiRekap(Object.assign({}, dasar, { akhir: -1 }), { master: {}, cekMaster: true, minus: {} }), ['MINUS']);
  assert.deepEqual(m.tandaiRekap(dasar, { master: {}, cekMaster: true, minus: {} }), ['PERNAH_MINUS']);
  assert.deepEqual(m.tandaiRekap(Object.assign({}, dasar, { awal: -2, akhir: -2, satuan: { A: 1, B: 1 } }), { master: null, cekMaster: true, minus: null }),
    ['MINUS', 'AWAL_MINUS', 'TIDAK_DI_MASTER', 'SATUAN_CAMPUR']);
  assert.deepEqual(m.tandaiRekap(Object.assign({}, dasar, { akhir: -0.0000001 }), { master: {}, cekMaster: false, minus: null }), [], 'toleransi pembulatan');
  assert.ok(m.bobotTanda(['SEBELUM_CUTOFF', 'MINUS']) < m.bobotTanda(['PERNAH_MINUS']));
  assert.ok(m.bobotTanda([]) > m.bobotTanda(['TANPA_TANGGAL']));
});

test('kunciIdHex', () => {
  assert.equal(m.kunciIdHex('6915366B1FF98A29F0BDC9D3'), '6915366b1ff98a29f0bdc9d3');
  assert.equal(m.kunciIdHex({ _bsontype: 'ObjectId', toHexString: () => 'ABCDEF0123456789ABCDEF01' }), 'abcdef0123456789abcdef01');
  assert.equal(m.kunciIdHex('bukan-id'), null);
  assert.equal(m.kunciIdHex(null), null);
});

test('bandingkanDenganSumber', () => {
  const tgl = new Date('2026-01-12T05:00:00Z');
  const baris = { qty: 200, kodeBarang: 'FG', arah: 'OUT', tanggal: tgl, satuan: 'PCE' };
  const cocok = { qty: 200, kodeBarang: 'FG', arah: 'OUT', tanggal: new Date('2026-01-12T16:00:00Z'), satuan: 'PCE', dihapus: false };
  assert.deepEqual(m.bandingkanDenganSumber(baris, cocok, '+07:00'), [], 'tanggal lokal sama (12 Jan WIB)');
  assert.deepEqual(m.bandingkanDenganSumber(baris, null, '+07:00'), ['SUMBER_HILANG']);
  assert.deepEqual(
    m.bandingkanDenganSumber(baris, Object.assign({}, cocok, { dihapus: true, qty: 150, kodeBarang: 'X', arah: 'IN', tanggal: new Date('2026-01-12T17:00:00Z'), satuan: 'YRD' }), '+07:00'),
    ['SUMBER_DIHAPUS', 'QTY_BEDA', 'KODE_BEDA', 'ARAH_BEDA', 'TANGGAL_BEDA', 'SATUAN_BEDA']
  );
  assert.deepEqual(m.bandingkanDenganSumber(baris, Object.assign({}, cocok, { qty: 200.0000001 }), '+07:00'), [], 'toleransi qty');
  assert.deepEqual(m.bandingkanDenganSumber(baris, Object.assign({}, cocok, { qty: null }), '+07:00'), ['QTY_BEDA']);
});

test('tujuanRujukan memakai rujukan sumber baris', () => {
  assert.equal(m.tujuanRujukan(mapping, { sumber: 'stok', asal: 'SCRAP', arah: 'OUT' }), 'scrapKeluar');
  assert.equal(m.tujuanRujukan(mapping, { sumber: 'stok', asal: 'MATERIALOUT', arah: 'OUT' }), 'materialKeluar');
  assert.equal(m.tujuanRujukan(mapping, { sumber: 'incoming', asal: 'incoming', arah: 'IN' }), null, 'sumber tanpa rujukan');
});
