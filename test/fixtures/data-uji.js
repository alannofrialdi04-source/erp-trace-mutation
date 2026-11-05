'use strict';
/**
 * Data dummy dengan anomali yang SENGAJA ditanam. Test lolos bila tool menemukan
 * persis anomali ini (tidak kurang, tidak lebih).
 *
 * Periode acuan: November 2025 (WIB) = [2025-10-31T17:00Z, 2025-11-30T17:00Z)
 *
 * uji_incomingdetail (sumber "masuk", arah IN)
 *   01  normal, 00:00 WIB 1 Nov, qty double
 *   02  normal, jam 10:15 WIB, qty int
 *   03  ANOMALI qty string yang masih bisa dikonversi ('75')
 *   04  ANOMALI qty string format Indonesia ('1.234,5') -> tidak bisa dikonversi
 *   05  ANOMALI kodeBarang dengan spasi di belakang ('BB-001 ')
 *   06  batas periode: 23:59:59 WIB 30 Nov -> MASUK November
 *   07  batas periode: 00:00 WIB 1 Des     -> TIDAK masuk November
 *   08  companyCode lain (PT2)
 *
 * uji_materialkeluardetail (sumber "keluar", arah OUT, nama field berbeda)
 *   01  normal
 *   02  ANOMALI qty negatif
 *   03  ANOMALI tanggal masa depan (2099)
 *
 * uji_koreksi (sumber "koreksi", arah TANDA_QTY) -> bersih
 *
 * uji_penyesuaianheader + uji_penyesuaiandetail (sumber "penyesuaian")
 *   01  TAMBAH            -> IN
 *   02  ' kurang '        -> OUT (dinormalisasi trim + huruf besar)
 *   03  ANOMALI 'KOREKSI' -> arah tidak dikenal
 *   04  ANOMALI idHeader menunjuk header yang tidak ada (detail yatim)
 */
const { D, OID, INT, DBL } = require('./ejson');

const H1 = '64b000000000000000000001';
const H2 = '64b000000000000000000002';
const H_HILANG = '64b0000000000000000000ff';
const id = (prefix, n) => OID(prefix + String(n).padStart(24 - prefix.length, '0'));

module.exports = {
  uji_incomingdetail: [
    { _id: id('65a', 1), tanggal: D('2025-10-31T17:00:00Z'), companyCode: 'PT1', kodeBarang: 'BB-001', qty: DBL(100), noAju: '000001', idAsal: null, status: 'POSTED' },
    { _id: id('65a', 2), tanggal: D('2025-11-10T03:15:00Z'), companyCode: 'PT1', kodeBarang: 'BB-002', qty: INT(50), noAju: '000002', status: 'POSTED' },
    { _id: id('65a', 3), tanggal: D('2025-11-12T17:00:00Z'), companyCode: 'PT1', kodeBarang: 'BB-002', qty: '75', noAju: '000003', status: 'POSTED' },
    { _id: id('65a', 4), tanggal: D('2025-11-13T17:00:00Z'), companyCode: 'PT1', kodeBarang: 'BB-003', qty: '1.234,5', noAju: '000004', status: 'DRAFT' },
    { _id: id('65a', 5), tanggal: D('2025-11-14T17:00:00Z'), companyCode: 'PT1', kodeBarang: 'BB-001 ', qty: DBL(20.5), noAju: '000005', status: 'POSTED' },
    { _id: id('65a', 6), tanggal: D('2025-11-30T16:59:59Z'), companyCode: 'PT1', kodeBarang: 'BB-001', qty: INT(10), noAju: '000006', status: 'POSTED' },
    { _id: id('65a', 7), tanggal: D('2025-11-30T17:00:00Z'), companyCode: 'PT1', kodeBarang: 'BB-001', qty: INT(5), noAju: '000007', status: 'POSTED' },
    { _id: id('65a', 8), tanggal: D('2025-11-15T17:00:00Z'), companyCode: 'PT2', kodeBarang: 'BB-001', qty: INT(7), noAju: '000008', status: 'POSTED' },
  ],

  uji_materialkeluardetail: [
    { _id: id('65b', 1), tglKeluar: D('2025-11-05T17:00:00Z'), companyCode: 'PT1', kodeMaterial: 'BB-001', jumlah: DBL(30), idIncoming: '65a000000000000000000001' },
    { _id: id('65b', 2), tglKeluar: D('2025-11-20T17:00:00Z'), companyCode: 'PT1', kodeMaterial: 'BB-002', jumlah: INT(-5), idIncoming: '65a000000000000000000002' },
    { _id: id('65b', 3), tglKeluar: D('2099-01-01T00:00:00Z'), companyCode: 'PT1', kodeMaterial: 'BB-002', jumlah: INT(1), idIncoming: '65a000000000000000000002' },
  ],

  uji_koreksi: [
    { _id: id('65c', 1), tanggal: D('2025-11-03T17:00:00Z'), companyCode: 'PT1', kodeBarang: 'BB-003', qty: DBL(10) },
    { _id: id('65c', 2), tanggal: D('2025-11-04T17:00:00Z'), companyCode: 'PT1', kodeBarang: 'BB-003', qty: DBL(-4) },
  ],

  uji_penyesuaianheader: [
    { _id: OID(H1), tanggal: D('2025-11-07T17:00:00Z'), companyCode: 'PT1', noDokumen: 'ADJ/2025/11/001' },
    { _id: OID(H2), tanggal: D('2025-11-08T17:00:00Z'), companyCode: 'PT1', noDokumen: 'ADJ/2025/11/002' },
  ],

  uji_penyesuaiandetail: [
    { _id: id('65d', 1), idHeader: H1, jenis: 'TAMBAH', kodeBarang: 'BB-001', qty: DBL(3) },
    { _id: id('65d', 2), idHeader: H1, jenis: ' kurang ', kodeBarang: 'BB-002', qty: DBL(2) },
    { _id: id('65d', 3), idHeader: H2, jenis: 'KOREKSI', kodeBarang: 'BB-001', qty: DBL(1) },
    { _id: id('65d', 4), idHeader: H_HILANG, jenis: 'TAMBAH', kodeBarang: 'BB-003', qty: DBL(9) },
  ],
};
