'use strict';
/**
 * dist/01-mutasi.js dengan config/mapping.js asli, terhadap data dummy berbentuk erpgarment.
 */
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helper');
const data = require('../fixtures/data-mutasi');

const DB = 'erp_trace_uji_mutasi';

function mutasi(config, opsi) {
  const r = h.jalankanTool('01-mutasi', DB, { CONFIG: Object.assign({ FORMAT: 'json', PERIODE: '2026-01' }, config) }, opsi);
  return opsi && opsi.bolehGagal ? r : h.ambilJSON(r.stdout).hasil;
}

const perKode = (hasil) => Object.fromEntries(hasil.kode.map((k) => [k.kodeBarang, k]));

before(() => {
  h.pastikanMongo();
  h.seed(DB, data);
});

test('rekap: saldo awal, masuk, keluar, saldo akhir per kode (batas periode WIB)', () => {
  const hasil = mutasi({});
  assert.equal(hasil.periode, '2026-01-01 s/d 2026-01-31 (WIB)');
  assert.deepEqual(hasil.sumberDihitung, ['stok']);
  const k = perKode(hasil);
  assert.deepEqual(Object.keys(k).sort(), ['CT-001', 'DS-MAT-001', 'FG-001', 'MAT-001', 'MAT-002', 'MAT-003', 'S001', 'SHI']);

  const a = k['MAT-001'];
  assert.deepEqual([a.awal, a.masuk, a.keluar, a.akhir], [100, 60, 145, 15], 'baris NGI tidak ikut, 23:59:59 WIB 31 Jan ikut, 00:00 WIB 1 Feb tidak');
  assert.equal(a.dokSesudah, 1);
  assert.deepEqual(a.perAsal, {
    MATERIALOUT: { masuk: 0, keluar: 135, dok: 3 },
    INCOMING: { masuk: 60, keluar: 0, dok: 1 },
    DEADSTOK: { masuk: 0, keluar: 10, dok: 1 },
  });
  assert.deepEqual([k['FG-001'].awal, k['FG-001'].masuk, k['FG-001'].keluar, k['FG-001'].akhir], [0, 500, 510, -10]);
  assert.deepEqual([k['CT-001'].awal, k['CT-001'].keluar, k['CT-001'].akhir], [200, 150, 50]);
  assert.equal(k['DS-MAT-001'].akhir, 10);
  assert.equal(k['MAT-001'].master.kategori, 'MATERIAL');
  assert.equal(k['MAT-001'].master.nama, 'KAIN A', 'master WAG, bukan NGI');
});

test('rekap: tanda masalah & transaksi pertama penyebab minus', () => {
  const hasil = mutasi({});
  const k = perKode(hasil);
  assert.deepEqual(k['MAT-001'].tanda, ['PERNAH_MINUS']);
  assert.deepEqual(k['MAT-002'].tanda, ['MINUS']);
  assert.deepEqual(k['FG-001'].tanda, ['MINUS']);
  assert.deepEqual(k.SHI.tanda, ['MINUS', 'TIDAK_DI_MASTER']);
  assert.deepEqual(k['MAT-003'].tanda, ['SATUAN_CAMPUR']);
  assert.deepEqual(k['MAT-003'].satuan, { MTR: 1, CJ: 1 });
  assert.deepEqual(k['CT-001'].tanda, ['SEBELUM_CUTOFF'], 'minus sebelum periode tidak dihitung PERNAH_MINUS');
  assert.deepEqual(k['DS-MAT-001'].tanda, []);

  assert.equal(k['MAT-001'].minus.tanggal, '2026-01-10T02:00:00.000Z');
  assert.equal(k['MAT-001'].minus.saldo, -30);
  assert.equal(k['MAT-001'].minus.asal, 'MATERIALOUT');
  assert.equal(k['FG-001'].minus.tanggal, '2026-01-20T05:00:00.000Z', 'saldo tepat 0 bukan minus');

  assert.deepEqual(hasil.ringkasan.tanda, { MINUS: 3, TIDAK_DI_MASTER: 1, PERNAH_MINUS: 1, SATUAN_CAMPUR: 1, SEBELUM_CUTOFF: 1 });
  assert.deepEqual(hasil.kode.map((x) => x.kodeBarang), ['FG-001', 'MAT-002', 'SHI', 'MAT-001', 'MAT-003', 'CT-001', 'DS-MAT-001', 'S001'],
    'urut: tanda terberat dulu');
  assert.deepEqual(hasil.ringkasan.perAsal.DELIVERY, { masuk: 0, keluar: 515, dok: 6 });
  assert.deepEqual(hasil.ringkasan.perAsal.INCOMING, { masuk: 1070, keluar: 0, dok: 3 });
});

test('rekap: filter KATEGORI dari master & KODE_BARANG', () => {
  const kat = mutasi({ KATEGORI: 'MATERIAL' });
  assert.deepEqual(kat.kode.map((x) => x.kodeBarang).sort(), ['DS-MAT-001', 'MAT-001', 'MAT-002', 'MAT-003']);
  const satu = mutasi({ KODE_BARANG: 'MAT-002' });
  assert.deepEqual(satu.kode.map((x) => x.kodeBarang), ['MAT-002']);
  const kosong = mutasi({ KATEGORI: 'TIDAK ADA' });
  assert.equal(kosong.kode.length, 0);
  assert.match(kosong.catatan[0], /Tidak ada kode barang di master/);
});

test('kartu: saldo berjalan, minus pertama, dan cek tiap baris ke dokumen sumber', () => {
  const hasil = mutasi({ MODE: 'kartu', KODE_BARANG: ['FG-001', 'MAT-001', 'TIDAKADA'] });
  const [fg, mat, tidak] = hasil.kartu;

  assert.deepEqual(fg.baris.map((b) => b.saldo), [500, 300, 150, 30, 0, -10]);
  assert.deepEqual(fg.baris.map((b) => b.cek), [[], [], ['SUMBER_DIHAPUS'], ['QTY_BEDA'], ['SUMBER_HILANG'], ['TANGGAL_BEDA']]);
  assert.deepEqual(fg.ringkasCek, { OK: 2, SUMBER_DIHAPUS: 1, QTY_BEDA: 1, SUMBER_HILANG: 1, TANGGAL_BEDA: 1 });
  assert.equal(fg.baris[1].dokSumber.noTransaksi, 'OUT20260112-00001');
  assert.equal(fg.baris[1].dokSumber.jenisDokumen, 'BC 30');
  assert.equal(fg.baris[3].dokSumber.qty, 100, 'qty dokumen sumber ditampilkan untuk QTY_BEDA');
  assert.equal(fg.minusPertama.saldo, -10);
  assert.equal(fg.saldoAkhir, -10);
  assert.equal(fg.saldoAkhirBerjalan, fg.saldoAkhir, 'saldo berjalan = rekap');

  assert.equal(mat.saldoAwal, 100);
  assert.deepEqual(mat.baris.map((b) => b.saldo), [20, -30, 30, 20, 15]);
  assert.deepEqual(mat.baris.map((b) => b.cek), [[], [], [], [], []], 'deadstock keluar dicek ke kodeBarangAsal');
  assert.equal(mat.baris[3].dokSumber.sumber, 'deadstokKeluar');
  assert.equal(mat.minusPertama.dokSumber.noTransaksi, 'OUTWH20260110-00001');
  assert.equal(mat.saldoAkhirBerjalan, 15);

  assert.equal(tidak.jumlahBaris, 0);
  assert.deepEqual(tidak.tanda, ['TIDAK_DI_MASTER']);
});

test('kartu: KARTU_MAKS_BARIS memotong baris, saldo akhir tetap dari rekap', () => {
  const hasil = mutasi({ MODE: 'kartu', KODE_BARANG: 'MAT-001', KARTU_MAKS_BARIS: 2 });
  const k = hasil.kartu[0];
  assert.equal(k.terpotong, true);
  assert.equal(k.jumlahBaris, 2);
  assert.equal(k.saldoAkhir, 15);
  assert.equal(k.saldoAkhirBerjalan, null);
});

test('format teks rekap & kartu', () => {
  const rekap = h.jalankanTool('01-mutasi', DB, { CONFIG: { PERIODE: '2026-01', HANYA_BERMASALAH: true } }).stdout;
  assert.match(rekap, /Ringkasan: 8 kode bergerak \| MINUS 3 \| PERNAH_MINUS 1 \| TIDAK_DI_MASTER 1 \| SATUAN_CAMPUR 1 \| SEBELUM_CUTOFF 1/);
  assert.match(rekap, /MAT-001 : 2026-01-10 09:00 \| MATERIALOUT OUT 50 \| saldo -30/);
  assert.doesNotMatch(rekap, /DS-MAT-001/, 'HANYA_BERMASALAH menyembunyikan kode tanpa tanda');
  const kartu = h.jalankanTool('01-mutasi', DB, { CONFIG: { PERIODE: '2026-01', MODE: 'kartu', KODE_BARANG: 'FG-001' } }).stdout;
  assert.match(kartu, /OUT20260116-00001\s+BC 30\s+120\s+30\s+PCE\s+QTY_BEDA/);
  assert.match(kartu, /Cek sumber: OK 2 \| SUMBER_DIHAPUS 1 \| QTY_BEDA 1 \| SUMBER_HILANG 1 \| TANGGAL_BEDA 1/);
});

test('CONFIG / MAPPING salah -> gagal dengan pesan jelas', () => {
  const r1 = mutasi({ MODE: 'kartu' }, { bolehGagal: true });
  assert.notEqual(r1.kode, 0);
  assert.match(r1.stdout + r1.stderr, /MODE "kartu" butuh CONFIG\.KODE_BARANG/);
  const r2 = mutasi({ MODE: 'lain' }, { bolehGagal: true });
  assert.match(r2.stdout + r2.stderr, /CONFIG\.MODE harus/);
  const r3 = h.jalankanTool('01-mutasi', DB, {
    CONFIG: { PERIODE: '2026-01' },
    MAPPING: { meta: { status: 'ASUMSI' }, sumber: { x: { koleksi: 'a', arah: 'MASUK', field: {} } } },
  }, { bolehGagal: true });
  assert.match(r3.stdout + r3.stderr, /MAPPING tidak valid/);
});
