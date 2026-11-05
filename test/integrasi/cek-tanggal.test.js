'use strict';
/**
 * dist/03-cek-tanggal.js dengan config/mapping.js asli terhadap fixture data-mutasi.
 * Kasus tertanam: TRFCUTTING20251208-00018 bertanggal 2024-11-29 (salah ketik tahun),
 * GRN20260315-00001 bertanggal 2026-01-02 (backdate 72 hari), OUT20260110-00001 bertanggal
 * 2026-01-22 (12 hari setelah registrasi), nomor deadstock tanpa tanggal.
 */
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helper');
const data = require('../fixtures/data-mutasi');

const DB = 'erp_trace_uji_tanggal';

function cek(config, opsi) {
  const r = h.jalankanTool('03-cek-tanggal', DB, { CONFIG: Object.assign({ FORMAT: 'json' }, config) }, opsi);
  return opsi && opsi.bolehGagal ? r : h.ambilJSON(r.stdout).hasil;
}
const perSumber = (hasil) => Object.fromEntries(hasil.sumber.map((s) => [s.sumber, s]));

before(() => {
  h.pastikanMongo();
  h.seed(DB, data);
});

test('salah ketik tahun, backdate jauh, dan tanggal setelah registrasi terdeteksi', () => {
  const hasil = cek({});
  assert.deepEqual(hasil.ringkasan, { jumlahDok: 32, anomali: 3, salahTahun: 1 });
  const s = perSumber(hasil);
  assert.ok(!s.stok, 'ledger tanpa noTransaksi dilewati');

  const [trf] = s.transferProduksi.anomali;
  assert.equal(trf.noTransaksi, 'TRFCUTTING20251208-00018');
  assert.equal(trf.selisih, -374);
  assert.equal(trf.tglReg, '2025-12-07T17:00:00.000Z', '00:00 WIB 8 Des 2025');
  assert.deepEqual([trf.dugaan, trf.saranTanggal], ['SALAH_TAHUN', '2025-11-29']);

  const [inc] = s.incoming.anomali;
  assert.deepEqual([inc.noTransaksi, inc.selisih, inc.jenis, inc.dugaan], ['GRN20260315-00001', -72, 'MUNDUR_JAUH', null]);
  assert.deepEqual(s.incoming.distribusi, { SESUAI: 8, MUNDUR_LEBIH_60: 1 });

  const [dlv] = s.delivery.anomali;
  assert.deepEqual([dlv.noTransaksi, dlv.selisih, dlv.jenis], ['OUT20260110-00001', 12, 'MAJU']);
  assert.deepEqual(s.deadstokMasuk.distribusi, { TANPA_TGL_REG: 1 });
});

test('SUMBER, PERIODE, dan batas hari', () => {
  assert.deepEqual(cek({ SUMBER: ['transferProduksi'] }).sumber.map((x) => x.sumber), ['transferProduksi']);

  const jan = perSumber(cek({ PERIODE: '2026-01' }));
  assert.equal(jan.transferProduksi.jumlahAnomali, 0, 'transfer 2024 di luar periode');
  assert.equal(jan.incoming.jumlahAnomali, 1);

  const longgar = perSumber(cek({ BATAS_MUNDUR_HARI: 80 }));
  assert.equal(longgar.incoming.jumlahAnomali, 0, 'backdate 72 hari masih dalam batas 80');
  assert.equal(longgar.transferProduksi.anomali[0].dugaan, 'SALAH_TAHUN');
});

test('format teks & CONFIG salah', () => {
  const teks = h.jalankanTool('03-cek-tanggal', DB, {}).stdout;
  assert.match(teks, /Ringkasan: 32 dokumen dicek \| 3 anomali \| 1 dugaan salah ketik tahun/);
  assert.match(teks, /2024-11-29\s+2025-12-08\s+-374\s+TRFCUTTING20251208-00018\s+CT-001\s+100\s+SALAH_TAHUN -> 2025-11-29/);

  const r1 = cek({ SUMBER: ['stok'] }, { bolehGagal: true });
  assert.match(r1.stdout + r1.stderr, /tidak punya field noTransaksi/);
  const r2 = cek({ BATAS_MUNDUR_HARI: -1 }, { bolehGagal: true });
  assert.match(r2.stdout + r2.stderr, /BATAS_MUNDUR_HARI harus bilangan bulat >= 0/);
});
