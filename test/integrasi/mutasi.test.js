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
  assert.deepEqual(Object.keys(k).sort(),
    ['CT-001', 'DS-MAT-001', 'FG-0001', 'FG-001', 'MAT-001', 'MAT-002', 'MAT-003', 'MAT-004', 'MAT-005', 'MAT-006', 'MAT-007', 'S001', 'SHI']);

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
  assert.equal(k['MAT-001'].minus.transisi, true);
  assert.equal(k['MAT-001'].minus.saldoSebelum, 20);
  assert.equal(k['MAT-001'].minus.saldo, -30);
  assert.equal(k['MAT-001'].minus.per, 'hari');
  assert.equal(k['MAT-001'].minus.hari, '2026-01-10');
  assert.equal(k['MAT-001'].minus.keluarHari, 50);
  assert.equal(k['FG-001'].minus.tanggal, '2026-01-20T05:00:00.000Z', 'saldo tepat 0 bukan minus');

  assert.deepEqual(k['MAT-004'].tanda, ['MINUS', 'AWAL_MINUS']);
  assert.equal(k['MAT-004'].minus.transisi, true, 'IN yang masih minus bukan penyebab; transisi ada di OUT 20');
  assert.deepEqual([k['MAT-004'].minus.saldoSebelum, k['MAT-004'].minus.saldo, k['MAT-004'].minus.keluarHari], [7, -13, 20]);
  assert.equal(k['MAT-004'].minus.jumlahMinus, 2, 'dua hari dengan saldo akhir minus (2 & 4 Jan)');
  assert.equal(k['MAT-005'].minus.transisi, false, 'minus sejak sebelum periode');
  assert.deepEqual([k['MAT-005'].minus.saldoMin, k['MAT-005'].minus.jumlahMinus], [-3, 1]);
  assert.deepEqual(k['MAT-006'].tanda, ['MINUS_SESAAT'], 'minus 10:00, pulih 10:05 di hari yang sama');
  assert.equal(k['MAT-006'].minus, null);
  assert.deepEqual(k['FG-0001'].tanda, ['MINUS', 'TIDAK_DI_MASTER']);
  assert.deepEqual(k['FG-0001'].kodeMirip, ['FG-001']);
  assert.deepEqual(k.SHI.kodeMirip, []);

  assert.deepEqual(hasil.ringkasan.tanda,
    { MINUS: 6, AWAL_MINUS: 2, TIDAK_DI_MASTER: 2, PERNAH_MINUS: 1, SATUAN_CAMPUR: 1, SEBELUM_CUTOFF: 1, MINUS_SESAAT: 1 });
  assert.deepEqual(hasil.kode.map((x) => x.kodeBarang),
    ['FG-0001', 'FG-001', 'MAT-002', 'MAT-004', 'MAT-005', 'SHI', 'MAT-001', 'MAT-003', 'CT-001', 'MAT-006', 'DS-MAT-001', 'MAT-007', 'S001'],
    'urut: tanda terberat dulu');
  assert.deepEqual(hasil.ringkasan.perAsal.DELIVERY, { masuk: 0, keluar: 518, dok: 7 });
  assert.deepEqual(hasil.ringkasan.perAsal.INCOMING, { masuk: 1090.2345, keluar: 0, dok: 8 });
});

test('rekap MINUS_PER transaksi: minus sesaat dihitung PERNAH_MINUS, penyebab per transaksi', () => {
  const hasil = mutasi({ MINUS_PER: 'transaksi' });
  const k = perKode(hasil);
  assert.deepEqual(k['MAT-006'].tanda, ['PERNAH_MINUS']);
  assert.equal(k['MAT-001'].minus.per, 'transaksi');
  assert.equal(k['MAT-001'].minus.asal, 'MATERIALOUT');
  assert.equal(k['MAT-001'].minus.qty, 50);
  assert.equal(hasil.ringkasan.tanda.MINUS_SESAAT, undefined);
});

test('rekap: filter KATEGORI dari master & KODE_BARANG', () => {
  const kat = mutasi({ KATEGORI: 'MATERIAL' });
  assert.deepEqual(kat.kode.map((x) => x.kodeBarang).sort(),
    ['DS-MAT-001', 'MAT-001', 'MAT-002', 'MAT-003', 'MAT-004', 'MAT-005', 'MAT-006', 'MAT-007']);
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

test('kartu: transisi ke minus, minus sejak sebelum periode, kode mirip', () => {
  const [m4, m5, fg] = mutasi({ MODE: 'kartu', KODE_BARANG: ['MAT-004', 'MAT-005', 'FG-0001'] }).kartu;
  assert.deepEqual(m4.baris.map((b) => b.saldo), [-3, 7, -13]);
  assert.equal(m4.minusSejakAwal, true);
  assert.deepEqual([m4.minusPertama.saldoSebelum, m4.minusPertama.saldo], [7, -13]);
  assert.equal(m4.minusPertama.dokSumber.noTransaksi, 'OUTWH20260104-00002');
  assert.equal(m5.minusSejakAwal, true);
  assert.equal(m5.minusPertama, null, 'tidak ada transisi di periode');
  assert.deepEqual(m5.tanda, ['MINUS', 'AWAL_MINUS']);
  assert.deepEqual(fg.kodeMirip, ['FG-001']);
  assert.deepEqual(fg.tanda, ['MINUS', 'TIDAK_DI_MASTER']);

  const [m6] = mutasi({ MODE: 'kartu', KODE_BARANG: 'MAT-006' }).kartu;
  assert.deepEqual(m6.baris.map((b) => b.saldo), [-5, 0]);
  assert.deepEqual(m6.baris.map((b) => b.akhirHari), [false, true]);
  assert.deepEqual(m6.tanda, ['MINUS_SESAAT']);
  assert.equal(m6.minusPertama, null);
  const [m6t] = mutasi({ MODE: 'kartu', KODE_BARANG: 'MAT-006', MINUS_PER: 'transaksi' }).kartu;
  assert.deepEqual(m6t.tanda, ['PERNAH_MINUS']);
  assert.equal(m6t.minusPertama.per, 'transaksi');
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
  assert.match(rekap, /Ringkasan: 13 kode bergerak \| MINUS 6 \| AWAL_MINUS 2 \| PERNAH_MINUS 1 \| TIDAK_DI_MASTER 2 \| SATUAN_CAMPUR 1 \| SEBELUM_CUTOFF 1 \| MINUS_SESAAT 1/);
  assert.match(rekap, /MAT-001 : hari 2026-01-10 \(masuk 0, keluar 50, 1 transaksi\) \| saldo akhir hari 20 -> -30/);
  assert.match(rekap, /MAT-003 .* CJ\+MTR /, 'satuan diurutkan');
  assert.match(rekap, /MAT-005 : sudah minus sejak sebelum periode \(saldo awal -5\)/);
  assert.match(rekap, /FG-0001 -> FG-001/);
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
