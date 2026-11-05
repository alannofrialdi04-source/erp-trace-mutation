'use strict';
/**
 * dist/02-rekon-opname.js dengan config/mapping.js asli terhadap fixture data-mutasi
 * (ledger + MONSUS per 31 Januari 2026).
 */
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helper');
const data = require('../fixtures/data-mutasi');

const DB = 'erp_trace_uji_rekon';

function rekon(config, opsi) {
  const r = h.jalankanTool('02-rekon-opname', DB, { CONFIG: Object.assign({ FORMAT: 'json' }, config) }, opsi);
  return opsi && opsi.bolehGagal ? r : h.ambilJSON(r.stdout).hasil;
}
const perKode = (hasil) => Object.fromEntries(hasil.kode.map((k) => [k.kodeBarang, k]));

before(() => {
  h.pastikanMongo();
  h.seed(DB, data);
});

test('saldo buku s/d akhir tanggal opname vs MONSUS BAP-03', () => {
  const hasil = rekon({});
  assert.equal(hasil.tanggal, '2026-01-31', 'tanggal diambil dari dokumen opname (23:59:59 WIB)');
  assert.equal(hasil.batasBuku, '2026-01-31T17:00:00.000Z');
  assert.deepEqual(hasil.ringkasan.status, { SELISIH: 3, HANYA_BUKU: 7, HANYA_OPNAME: 1, COCOK: 1 });
  const k = perKode(hasil);

  assert.deepEqual([k['MAT-001'].buku, k['MAT-001'].fisik, k['MAT-001'].status], [15, 15, 'COCOK'],
    'transaksi 23:59:59 WIB 31 Jan ikut, 00:00 WIB 1 Feb tidak; BAP-2/BAP-1/NGI tersaring');
  assert.deepEqual([k['MAT-002'].buku, k['MAT-002'].fisik, k['MAT-002'].selisih], [-15, 0, 15]);
  assert.deepEqual(k['MAT-002'].tanda, ['BUKU_MINUS']);
  assert.deepEqual([k['MAT-003'].fisik, k['MAT-003'].barisOpname, k['MAT-003'].selisih], [990, 2, -8]);
  assert.deepEqual(k['MAT-003'].tanda, ['SATUAN_CAMPUR', 'OPNAME_GANDA']);
  assert.deepEqual([k['S001'].status, k['S001'].selisih], ['HANYA_BUKU', -455]);
  assert.deepEqual([k['OPN-ONLY'].status, k['OPN-ONLY'].buku, k['OPN-ONLY'].selisih], ['HANYA_OPNAME', null, 5]);
  assert.deepEqual(k['OPN-ONLY'].tanda, ['TIDAK_DI_MASTER']);

  assert.deepEqual(hasil.kode.map((x) => x.kodeBarang), [
    'MAT-002', 'FG-001', 'MAT-003',
    'S001', 'CT-001', 'MAT-004', 'DS-MAT-001', 'SHI', 'FG-0001', 'MAT-005',
    'OPN-ONLY',
    'MAT-001',
  ], 'urut status lalu |selisih| terbesar');
});

test('NO_BAP kosong menggabungkan BAP dalam satu noReg', () => {
  const k = perKode(rekon({ NO_BAP: null }));
  assert.deepEqual([k['MAT-001'].fisik, k['MAT-001'].status, k['MAT-001'].selisih], [115, 'SELISIH', 100]);
  assert.ok(k['MAT-001'].tanda.includes('OPNAME_GANDA'));
});

test('TANGGAL eksplisit & KATEGORI', () => {
  const k = perKode(rekon({ TANGGAL: '2026-01-15' }));
  assert.equal(k['MAT-001'].buku, 30, 'saldo s/d akhir 15 Jan: 100 - 80 - 50 + 60');

  const kat = rekon({ KATEGORI: 'MATERIAL' });
  assert.deepEqual(kat.kode.map((x) => x.kodeBarang).sort(), ['DS-MAT-001', 'MAT-001', 'MAT-002', 'MAT-003', 'MAT-004', 'MAT-005']);
});

test('dokumen opname dengan beberapa tanggal tanpa TANGGAL -> error jelas', () => {
  const r = rekon({ NO_REG: null, NO_BAP: null }, { bolehGagal: true });
  assert.notEqual(r.kode, 0);
  assert.match(r.stdout + r.stderr, /2 tanggal berbeda \(2026-01-31, 2026-04-06\)/);
  const r2 = rekon({ OPNAME: 'salah' }, { bolehGagal: true });
  assert.match(r2.stdout + r2.stderr, /tidak ada di MAPPING\.opname \(tersedia: monsus, stokopname\)/);
});

test('format teks: default hanya yang tidak cocok, TAMPIL semua menampilkan COCOK', () => {
  const teks = h.jalankanTool('02-rekon-opname', DB, {}).stdout;
  assert.match(teks, /Ringkasan: 12 kode \| SELISIH 3 \| HANYA_BUKU 7 \| HANYA_OPNAME 1 \| COCOK 1/);
  assert.match(teks, /MAT-002\s+KAIN B\s+MATERIAL\s+YRD\s+-15\s+0\s+15\s+SELISIH\s+BUKU_MINUS/);
  assert.doesNotMatch(teks, /MAT-001\s+KAIN A/);
  const semua = h.jalankanTool('02-rekon-opname', DB, { CONFIG: { TAMPIL: 'semua' } }).stdout;
  assert.match(semua, /MAT-001\s+KAIN A\s+MATERIAL\s+YRD\s+15\s+15\s+0\s+COCOK/);
});
