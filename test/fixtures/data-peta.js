'use strict';
/**
 * Data dummy berbentuk mirip erpgarment untuk test 00-peta-data.
 * Rantai relasi: barangmasukdetail -> incomingdetail -> materialkeluardetail -> tbl_stok,
 * plus header dengan listDetail tertanam dan dokumen company lain (NGI) yang harus tersaring.
 */
const { D, OID, INT, DBL } = require('./ejson');

const BM1 = '66a000000000000000000001';
const BM2 = '66a000000000000000000002';
const INC1 = '66b000000000000000000001';
const INC2 = '66b000000000000000000002';
const MK1 = '66c000000000000000000001';
const MK2 = '66c000000000000000000002';
const MK3 = '66c000000000000000000003';
const HILANG = '66f0000000000000000000ff';

module.exports = {
  ids: { BM1, BM2, INC1, INC2, MK1, MK2, MK3, HILANG },
  data: {
    tbl_barangmasukdetail: [
      { _id: OID(BM1), companyCode: 'WAG', idDokumen: 'BC 23', jenisBc: 'MATERIAL', isDeleted: false, isReceiv: true, qty: DBL(100), qtyWh: DBL(100), satuan: 'KGM', satuanWh: 'KGM', tglPenerimaan: D('2025-11-01T02:00:00Z') },
      { _id: OID(BM2), companyCode: 'WAG', idDokumen: 'BC 27', jenisBc: 'MATERIAL', isDeleted: false, isReceiv: true, qty: INT(10), qtyWh: INT(120), satuan: 'ROL', satuanWh: 'YRD', tglPenerimaan: D('2025-11-02T02:00:00Z') },
    ],
    tbl_incomingdetail: [
      { _id: OID(INC1), companyCode: 'WAG', idAsal: BM1, idDokumen: '23', jenisBc: 'MATERIAL', isDeleted: false, isReceiv: true, qtyWh: DBL(100), tglMasuk: D('2025-11-01T03:00:00Z') },
      { _id: OID(INC2), companyCode: 'WAG', idAsal: BM2, idDokumen: 'BC 27', jenisBc: 'MATERIAL', isDeleted: false, isReceiv: true, qtyWh: INT(120), tglMasuk: D('2025-11-02T03:00:00Z') },
      { _id: OID('66b0000000000000000000a1'), companyCode: 'NGI', idAsal: BM1, idDokumen: 'BC 23', jenisBc: 'MATERIAL', isDeleted: false, isReceiv: true, qtyWh: INT(5), tglMasuk: D('2025-11-03T03:00:00Z') },
    ],
    tbl_incomingheader: [
      { _id: OID('66b100000000000000000001'), companyCode: 'WAG', listDetail: [{ _id: OID(INC1), qty: DBL(100) }] },
    ],
    tbl_materialkeluardetail: [
      { _id: OID(MK1), companyCode: 'WAG', idAsal: INC1, approveStatus: 'Received', isDeleted: false, qtyKeluarOk: DBL(30), tglKeluar: D('2025-11-05T03:00:00Z') },
      { _id: OID(MK2), companyCode: 'WAG', idAsal: INC2, approveStatus: 'Received', isDeleted: false, qtyKeluarOk: DBL(20), tglKeluar: D('2025-11-06T03:00:00Z') },
      { _id: OID(MK3), companyCode: 'WAG', idAsal: HILANG, approveStatus: 'Pending', isDeleted: true, qtyKeluarOk: DBL(5), tglKeluar: D('2025-11-07T03:00:00Z') },
    ],
    tbl_stok: [
      { _id: OID('66d000000000000000000001'), companyCode: 'WAG', asal: 'MATERIALOUT', jenis: 'OUT', namaProses: 'WAREHOUSE', idAsal: MK1, qty: DBL(30), tanggal: D('2025-11-05T03:00:00Z'), _class: 'insys.models.stok.Stok' },
      { _id: OID('66d000000000000000000002'), companyCode: 'WAG', asal: 'MATERIALOUT', jenis: 'OUT', namaProses: 'WAREHOUSE', idAsal: MK2, qty: DBL(20), tanggal: D('2025-11-06T03:00:00Z') },
      { _id: OID('66d000000000000000000003'), companyCode: 'WAG', asal: 'INCOMING', jenis: 'IN', namaProses: 'WAREHOUSE', idAsal: OID(INC1), qty: DBL(100), tanggal: D('2025-11-01T03:00:00Z') },
      { _id: OID('66d000000000000000000004'), companyCode: 'WAG', asal: 'INCOMING', jenis: 'IN', namaProses: 'WAREHOUSE', idAsal: INC2, qty: DBL(120), tanggal: D('2025-11-02T03:00:00Z') },
      { _id: OID('66d0000000000000000000a1'), companyCode: 'NGI', asal: 'INCOMING', jenis: 'IN', namaProses: 'WAREHOUSE', idAsal: 'bukan-id', qty: DBL(5), tanggal: D('2025-11-03T03:00:00Z') },
    ],
  },
};
