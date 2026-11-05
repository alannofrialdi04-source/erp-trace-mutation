'use strict';
/**
 * Mapping khusus test. Sengaja memakai nama field yang berbeda-beda
 * (tglKeluar, kodeMaterial, jumlah) dan relasi header dengan link string -> ObjectId,
 * supaya engine normalisasi teruji tidak bergantung pada satu bentuk schema.
 */
module.exports = {
  meta: { status: 'TERVERIFIKASI', catatan: 'Mapping data dummy untuk test' },
  timezone: '+07:00',
  sumber: {
    masuk: {
      label: 'Incoming (uji)',
      koleksi: 'uji_incomingdetail',
      arah: 'IN',
      kategori: 'BB',
      field: {
        tanggal: 'tanggal',
        companyCode: 'companyCode',
        kodeBarang: 'kodeBarang',
        qty: 'qty',
        noAju: 'noAju',
      },
    },
    keluar: {
      label: 'Material Out (uji)',
      koleksi: 'uji_materialkeluardetail',
      arah: 'OUT',
      kategori: 'BB',
      field: {
        tanggal: 'tglKeluar',
        companyCode: 'companyCode',
        kodeBarang: 'kodeMaterial',
        qty: 'jumlah',
        idAsal: 'idIncoming',
      },
    },
    koreksi: {
      label: 'Koreksi bertanda (uji)',
      koleksi: 'uji_koreksi',
      arah: 'TANDA_QTY',
      field: {
        tanggal: 'tanggal',
        companyCode: 'companyCode',
        kodeBarang: 'kodeBarang',
        qty: 'qty',
      },
    },
    penyesuaian: {
      label: 'Penyesuaian (uji)',
      koleksi: 'uji_penyesuaiandetail',
      arah: { field: 'jenis', nilai: { TAMBAH: 'IN', KURANG: 'OUT' } },
      field: {
        kodeBarang: 'kodeBarang',
        qty: 'qty',
      },
      header: {
        koleksi: 'uji_penyesuaianheader',
        localField: 'idHeader',
        foreignField: '_id',
        konversi: 'toObjectId',
        field: {
          tanggal: 'tanggal',
          companyCode: 'companyCode',
          noTransaksi: 'noDokumen',
        },
      },
    },
  },
};
