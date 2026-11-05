'use strict';
/**
 * Data dummy berbentuk erpgarment (nama koleksi & field asli) untuk test 01-mutasi
 * dengan config/mapping.js. Periode acuan: Januari 2026 (WIB).
 *
 * MAT-001  saldo awal 100 -> sempat minus (-30) lalu pulih, akhir 15        => PERNAH_MINUS
 *          + deadstock keluar (kodeBarangAsal) + transaksi tepat di batas jam WIB
 * MAT-002  akhir -15                                                         => MINUS
 * MAT-003  satuan ledger MTR & CJ                                            => SATUAN_CAMPUR
 * FG-001   produksi 500, delivery 510, akhir -10                             => MINUS
 *          baris ledger: sumber dihapus, qty beda, sumber hilang, tanggal beda
 * CT-001   transfer bertanggal 2024-11-29 (sebelum cut-off 2025-08-18)       => SEBELUM_CUTOFF
 * SHI      delivery kode yang tidak ada di master                            => MINUS + TIDAK_DI_MASTER
 * DS-MAT-001, S001  normal
 * Baris companyCode NGI harus tersaring.
 */
const { D, OID, INT, DBL } = require('./ejson');

const id = (awalan, n) => awalan + String(n).padStart(24 - awalan.length, '0');

const INC = { A1: id('7a1', 1), A2: id('7a1', 2), B1: id('7a1', 3), C1: id('7a1', 4) };
const MK = { A1: id('7b1', 1), A2: id('7b1', 2), A3: id('7b1', 3), A4: id('7b1', 4), B1: id('7b1', 5), C1: id('7b1', 6) };
const PRD = { FG: id('7c1', 1), CT: id('7c1', 2) };
const DLV = { D1: id('7d1', 1), D2: id('7d1', 2), D3: id('7d1', 3), D4: id('7d1', 4), SHI: id('7d1', 5) };
const TRF = { T1: id('7e1', 1), T2: id('7e1', 2) };
const DS1 = id('7f1', 1);
const SCP1 = id('7f2', 1);
const HILANG = id('7ff', 1);
const BM = id('7a0', 1);

let urutStok = 0;
function stok(asal, jenis, kode, qty, satuan, tanggal, idAsal, proses, companyCode) {
  urutStok += 1;
  return {
    _id: OID(id('790', urutStok)),
    companyCode: companyCode || 'WAG',
    asal: asal,
    jenis: jenis,
    kodeBarang: kode,
    qty: DBL(qty),
    satuan: satuan,
    tanggal: D(tanggal),
    tanggalString: tanggal.slice(0, 10),
    idAsal: idAsal,
    namaProses: proses || '',
    infoProses: proses ? 'RESULT' : '',
  };
}

function incoming(_id, kode, qty, satuan, tgl, noReg) {
  return {
    _id: OID(_id), companyCode: 'WAG', kodeBarang: kode, qty: DBL(qty), qtyWh: DBL(qty), satuan: satuan, satuanWh: satuan,
    tglMasuk: D(tgl), noReg: noReg, idAsal: BM, idDokumen: 'BC 23', noAju: '000023000000000000000001', noUrut: '000001', isDeleted: false,
  };
}

function materialKeluar(_id, kode, qty, satuan, tgl, noReg, idAsal) {
  return {
    _id: OID(_id), companyCode: 'WAG', kodeMaterial: kode, kodeBarang: 'FG-001', qtyKeluarOk: DBL(qty), satuanKeluarOk: satuan,
    satuan: satuan, tglKeluar: D(tgl), noReg: noReg, idAsal: idAsal, idDokumen: 'BC 23', noAju: '000023000000000000000001',
    noUrut: '000001', approveStatus: 'Received', isDeleted: false,
  };
}

function delivery(_id, kode, qty, tgl, noReg, isDeleted) {
  return {
    _id: OID(_id), companyCode: 'WAG', kodeBarang: kode, jmlKeluar: DBL(qty), jmlKeluarOk: DBL(qty), satuan: 'PCE',
    tglKeluar: D(tgl), noReg: noReg, idDokumen: 'BC 30', noAju: '000030000000000000000001', noUrut: '000002', isDeleted: isDeleted,
  };
}

module.exports = {
  tbl_barang: [
    { companyCode: 'WAG', kodeBarang: 'MAT-001', namaBarang: 'KAIN A', jenisBc: 'MATERIAL', satuan: 'YRD' },
    { companyCode: 'WAG', kodeBarang: 'MAT-002', namaBarang: 'KAIN B', jenisBc: 'MATERIAL', satuan: 'YRD' },
    { companyCode: 'WAG', kodeBarang: 'MAT-003', namaBarang: 'BENANG', jenisBc: 'MATERIAL', satuan: 'CJ' },
    { companyCode: 'WAG', kodeBarang: 'DS-MAT-001', namaBarang: 'DEADSTOCK KAIN A', jenisBc: 'MATERIAL', satuan: 'YRD' },
    { companyCode: 'WAG', kodeBarang: 'FG-001', namaBarang: 'KAOS', jenisBc: 'BARANG JADI', satuan: 'PCE' },
    { companyCode: 'WAG', kodeBarang: 'CT-001', namaBarang: 'CUTTING KAOS', jenisBc: 'BARANG SETENGAH JADI', satuan: 'PCE' },
    { companyCode: 'WAG', kodeBarang: 'S001', namaBarang: 'POTONGAN KAIN SISA', jenisBc: 'SCRAP', satuan: 'KGM' },
    { companyCode: 'NGI', kodeBarang: 'MAT-001', namaBarang: 'KAIN A NGI', jenisBc: 'MATERIAL', satuan: 'YRD' },
  ],

  tbl_incomingdetail: [
    incoming(INC.A1, 'MAT-001', 100, 'YRD', '2025-12-10T03:00:00Z', 'GRN20251210-00001'),
    incoming(INC.A2, 'MAT-001', 60, 'YRD', '2026-01-15T03:00:00Z', 'GRN20260115-00001'),
    incoming(INC.B1, 'MAT-002', 10, 'YRD', '2026-01-03T03:00:00Z', 'GRN20260103-00001'),
    incoming(INC.C1, 'MAT-003', 1000, 'MTR', '2026-01-02T03:00:00Z', 'GRN20260102-00001'),
  ],

  tbl_materialkeluardetail: [
    materialKeluar(MK.A1, 'MAT-001', 80, 'YRD', '2026-01-05T02:00:00Z', 'OUTWH20260105-00001', INC.A1),
    materialKeluar(MK.A2, 'MAT-001', 50, 'YRD', '2026-01-10T02:00:00Z', 'OUTWH20260110-00001', INC.A1),
    materialKeluar(MK.A3, 'MAT-001', 5, 'YRD', '2026-01-31T16:59:59Z', 'OUTWH20260131-00001', INC.A2),
    materialKeluar(MK.A4, 'MAT-001', 7, 'YRD', '2026-01-31T17:00:00Z', 'OUTWH20260201-00001', INC.A2),
    materialKeluar(MK.B1, 'MAT-002', 25, 'YRD', '2026-01-04T02:00:00Z', 'OUTWH20260104-00001', INC.B1),
    materialKeluar(MK.C1, 'MAT-003', 2, 'CJ', '2026-01-06T02:00:00Z', 'OUTWH20260106-00001', INC.C1),
  ],

  tbl_productiondetail: [
    { _id: OID(PRD.FG), companyCode: 'WAG', info: 'result', kodeProses: 'FINISHGOODS', namaProses: 'FINISHGOODS', kodeBarang: 'FG-001', qty: DBL(500), satuan: 'PCE', tanggal: D('2026-01-08T05:00:00Z'), noReg: 'PRDFINISHGOODS20260108-00001', jenisDokumenBc: 'BC 40', isDeleted: false },
    { _id: OID(PRD.CT), companyCode: 'WAG', info: 'result', kodeProses: 'PROD2', namaProses: 'CUTTING', kodeBarang: 'CT-001', qty: DBL(300), satuan: 'PCE', tanggal: D('2025-09-01T05:00:00Z'), noReg: 'PRDCUTTING20250901-00001', jenisDokumenBc: 'BC 40', isDeleted: false },
  ],

  tbl_deliverydetail: [
    delivery(DLV.D1, 'FG-001', 200, '2026-01-12T05:00:00Z', 'OUT20260112-00001', false),
    delivery(DLV.D2, 'FG-001', 150, '2026-01-14T05:00:00Z', 'OUT20260114-00001', true),
    delivery(DLV.D3, 'FG-001', 100, '2026-01-16T05:00:00Z', 'OUT20260116-00001', false),
    delivery(DLV.D4, 'FG-001', 10, '2026-01-25T05:00:00Z', 'OUT20260125-00001', false),
    delivery(DLV.SHI, 'SHI', 5, '2026-01-22T05:00:00Z', 'OUT20260122-00001', false),
  ],

  tbl_transferproduction: [
    { _id: OID(TRF.T1), companyCode: 'WAG', kodeBarang: 'CT-001', qty: DBL(100), satuan: 'PCE', tanggal: D('2024-11-29T05:00:00Z'), noReg: 'TRFCUTTING20241129-00001', namaProses: 'CUTTING', kodeProses: 'PROD2', kodeProsesTujuan: 'PROD1', jenisDokumenBc: 'BC 40', idAsal: PRD.CT, isDeleted: false },
    { _id: OID(TRF.T2), companyCode: 'WAG', kodeBarang: 'CT-001', qty: DBL(150), satuan: 'PCE', tanggal: D('2026-01-09T05:00:00Z'), noReg: 'TRFCUTTING20260109-00001', namaProses: 'CUTTING', kodeProses: 'PROD2', kodeProsesTujuan: 'PROD1', jenisDokumenBc: 'BC 40', idAsal: PRD.CT, isDeleted: false },
  ],

  tbl_deadstokdetail: [
    { _id: OID(DS1), companyCode: 'WAG', kodeBarang: 'DS-MAT-001', kodeBarangAsal: 'MAT-001', qty: DBL(10), satuan: 'YRD', tanggal: D('2026-01-20T17:00:00Z'), nomorLapor: '0001DS2026', idAsalIncoming: INC.A2, idDokumen: 'BC 23', noAju: '000023000000000000000001', noUrut: '000001' },
  ],

  exim_scrapdetail: [
    { _id: OID(SCP1), companyCode: 'WAG', kodeBarang: 'S001', qty: INT(455), satuan: 'KGM', tanggal: D('2026-01-11T09:00:00Z'), noReg: 'SCP-20260111-00001', isDeleted: false },
  ],

  tbl_stok: [
    stok('INCOMING', 'IN', 'MAT-001', 100, 'YRD', '2025-12-10T03:00:00Z', INC.A1),
    stok('MATERIALOUT', 'OUT', 'MAT-001', 80, 'YRD', '2026-01-05T02:00:00Z', MK.A1),
    stok('MATERIALOUT', 'OUT', 'MAT-001', 50, 'YRD', '2026-01-10T02:00:00Z', MK.A2),
    stok('INCOMING', 'IN', 'MAT-001', 60, 'YRD', '2026-01-15T03:00:00Z', INC.A2),
    stok('DEADSTOK', 'OUT', 'MAT-001', 10, 'YRD', '2026-01-20T17:00:00Z', DS1),
    stok('DEADSTOK', 'IN', 'DS-MAT-001', 10, 'YRD', '2026-01-20T17:00:00Z', DS1),
    stok('MATERIALOUT', 'OUT', 'MAT-001', 5, 'YRD', '2026-01-31T16:59:59Z', MK.A3),
    stok('MATERIALOUT', 'OUT', 'MAT-001', 7, 'YRD', '2026-01-31T17:00:00Z', MK.A4),
    stok('INCOMING', 'IN', 'MAT-002', 10, 'YRD', '2026-01-03T03:00:00Z', INC.B1),
    stok('MATERIALOUT', 'OUT', 'MAT-002', 25, 'YRD', '2026-01-04T02:00:00Z', MK.B1),
    stok('INCOMING', 'IN', 'MAT-003', 1000, 'MTR', '2026-01-02T03:00:00Z', INC.C1),
    stok('MATERIALOUT', 'OUT', 'MAT-003', 2, 'CJ', '2026-01-06T02:00:00Z', MK.C1),
    stok('PRODUCTION', 'IN', 'FG-001', 500, 'PCE', '2026-01-08T05:00:00Z', PRD.FG, 'FINISHGOODS'),
    stok('DELIVERY', 'OUT', 'FG-001', 200, 'PCE', '2026-01-12T05:00:00Z', DLV.D1),
    stok('DELIVERY', 'OUT', 'FG-001', 150, 'PCE', '2026-01-14T05:00:00Z', DLV.D2),
    stok('DELIVERY', 'OUT', 'FG-001', 120, 'PCE', '2026-01-16T05:00:00Z', DLV.D3),
    stok('DELIVERY', 'OUT', 'FG-001', 30, 'PCE', '2026-01-18T05:00:00Z', HILANG),
    stok('DELIVERY', 'OUT', 'FG-001', 10, 'PCE', '2026-01-20T05:00:00Z', DLV.D4),
    stok('PRODUCTION', 'IN', 'CT-001', 300, 'PCE', '2025-09-01T05:00:00Z', PRD.CT, 'CUTTING'),
    stok('TRANSFER', 'OUT', 'CT-001', 100, 'PCE', '2024-11-29T05:00:00Z', TRF.T1, 'CUTTING'),
    stok('TRANSFER', 'OUT', 'CT-001', 150, 'PCE', '2026-01-09T05:00:00Z', TRF.T2, 'CUTTING'),
    stok('DELIVERY', 'OUT', 'SHI', 5, 'PCE', '2026-01-22T05:00:00Z', DLV.SHI),
    stok('SCRAP', 'IN', 'S001', 455, 'KGM', '2026-01-11T09:00:00Z', SCP1),
    stok('INCOMING', 'IN', 'MAT-001', 999, 'YRD', '2026-01-07T03:00:00Z', INC.A1, '', 'NGI'),
  ],
};
