/**
 * MAPPING SUMBER MUTASI
 * =====================
 * Satu-satunya file yang perlu disesuaikan dengan struktur database ERP.
 * Setelah diubah, jalankan `npm run build` supaya semua file di dist/ ikut terbarui.
 *
 * STATUS SAAT INI: ASUMSI
 *   Nama koleksi diambil dari daftar koleksi yang sudah disebutkan.
 *   Nama field, arah, kategori, dan relasi header MASIH TEBAKAN.
 *   Verifikasi dengan:
 *     1. dist/00-profil-skema.js  -> lihat field & tipe data yang sebenarnya
 *     2. dist/00-cek-mapping.js   -> cek apakah mapping ini cocok dengan data
 *
 * FORMAT PER SUMBER
 *   label        : nama yang tampil di laporan
 *   koleksi      : nama koleksi detail transaksi
 *   arah         : 'IN' | 'OUT'
 *                  | 'TANDA_QTY'  (qty bertanda: positif = IN, negatif = OUT)
 *                  | { field: 'jenis', dari: 'detail' | 'header', nilai: { TAMBAH: 'IN', KURANG: 'OUT' } }
 *                    (nilai dibandingkan setelah trim + huruf besar)
 *   kategori     : bebas, mis. 'BB' (bahan baku) / 'BJ' (barang jadi)
 *   hitungMutasi : false = tidak ikut dihitung di saldo
 *                  (mis. modul yang mencatat transaksi yang sama dengan modul lain)
 *   filter       : filter MongoDB tambahan untuk dokumen yang valid,
 *                  mis. { isDeleted: { $ne: true }, status: 'POSTED' }
 *   field        : { fieldLogis: 'namaFieldDiDokumen' }
 *                  wajib    : tanggal, companyCode, kodeBarang, qty
 *                  opsional : noTransaksi, idAsal, idDokumen, noAju, noReg, noUrut,
 *                             jenisDokumen, satuan, gudang, createdAt
 *   header       : (opsional) kalau sebagian field ada di koleksi header
 *                  {
 *                    koleksi      : 'tbl_xxxheader',
 *                    localField   : field di detail yang menunjuk ke header,
 *                    foreignField : field kunci di header (default '_id'),
 *                    konversi     : null | 'toObjectId' | 'toString'
 *                                   (kalau tipe localField beda dengan foreignField),
 *                    filter       : filter tambahan untuk header (kondisi per field),
 *                    field        : { fieldLogis: 'namaFieldDiHeader' }
 *                  }
 */
module.exports = {
  meta: {
    status: 'ASUMSI', // 'ASUMSI' | 'TERVERIFIKASI'
    catatan: 'Nama field masih tebakan, belum diverifikasi dengan data asli.',
  },

  // Zona waktu untuk batas periode & tampilan tanggal (WIB)
  timezone: '+07:00',

  sumber: {
    incoming: {
      label: 'Incoming Warehouse',
      koleksi: 'tbl_incomingdetail',
      arah: 'IN',
      kategori: 'BB',
      field: {
        tanggal: 'tanggal',
        companyCode: 'companyCode',
        kodeBarang: 'kodeBarang',
        qty: 'qty',
        idAsal: 'idAsal',
        idDokumen: 'idDokumen',
        noAju: 'noAju',
        noReg: 'noReg',
        noUrut: 'noUrut',
      },
    },

    barangMasuk: {
      label: 'Barang Masuk',
      koleksi: 'tbl_barangmasukdetail',
      arah: 'IN',
      kategori: 'BB',
      // ASUMSI: kemungkinan mencatat transaksi yang sama dengan incoming.
      // Dimatikan dari hitungan saldo sampai dipastikan di Fase 1.
      hitungMutasi: false,
      field: {
        tanggal: 'tanggal',
        companyCode: 'companyCode',
        kodeBarang: 'kodeBarang',
        qty: 'qty',
        idAsal: 'idAsal',
        noAju: 'noAju',
        noReg: 'noReg',
        noUrut: 'noUrut',
      },
    },

    materialKeluar: {
      label: 'Material Out',
      koleksi: 'tbl_materialkeluardetail',
      arah: 'OUT',
      kategori: 'BB',
      field: {
        tanggal: 'tanggal',
        companyCode: 'companyCode',
        kodeBarang: 'kodeBarang', // bisa jadi 'kodeMaterial'
        qty: 'qty',
        idAsal: 'idAsal',
        noUrut: 'noUrut',
      },
    },

    delivery: {
      label: 'Delivery',
      koleksi: 'tbl_deliverydetail',
      arah: 'OUT',
      kategori: 'BJ',
      field: {
        tanggal: 'tanggal',
        companyCode: 'companyCode',
        kodeBarang: 'kodeBarang',
        qty: 'qty',
        idAsal: 'idAsal',
        idDokumen: 'idDokumen',
        noAju: 'noAju',
        noReg: 'noReg',
        noUrut: 'noUrut',
      },
    },

    produksi: {
      label: 'Production',
      koleksi: 'tbl_productiondetail',
      arah: 'IN',
      kategori: 'BJ',
      field: {
        tanggal: 'tanggal',
        companyCode: 'companyCode',
        kodeBarang: 'kodeBarang',
        qty: 'qty',
        idAsal: 'idAsal',
      },
    },

    receivingProduksi: {
      label: 'Production Receiving',
      koleksi: 'tbl_receivingproduction',
      arah: 'IN',
      kategori: 'BJ',
      // ASUMSI: kemungkinan tumpang tindih dengan produksi. Dipastikan di Fase 1.
      hitungMutasi: false,
      field: {
        tanggal: 'tanggal',
        companyCode: 'companyCode',
        kodeBarang: 'kodeBarang',
        qty: 'qty',
        idAsal: 'idAsal',
      },
    },

    transferProduksi: {
      label: 'Transfer Production',
      koleksi: 'tbl_transferproduction',
      arah: 'OUT', // ASUMSI: arah belum diketahui
      kategori: 'BB',
      hitungMutasi: false,
      field: {
        tanggal: 'tanggal',
        companyCode: 'companyCode',
        kodeBarang: 'kodeBarang',
        qty: 'qty',
        idAsal: 'idAsal',
      },
    },

    penyesuaian: {
      label: 'Stock Adjustment',
      koleksi: 'tbl_stokpenyesuaiandetail',
      arah: { field: 'jenis', dari: 'detail', nilai: { TAMBAH: 'IN', KURANG: 'OUT' } },
      field: {
        kodeBarang: 'kodeBarang',
        qty: 'qty',
      },
      header: {
        koleksi: 'tbl_stokpenyesuaianheader',
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
