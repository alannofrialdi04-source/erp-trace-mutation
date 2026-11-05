/**
 * MAPPING SUMBER MUTASI: database erpgarment
 * ==========================================
 * Satu-satunya file yang perlu disesuaikan dengan struktur database ERP.
 * Setelah diubah, jalankan `npm run build` supaya semua file di dist/ ikut terbarui.
 *
 * DASAR MAPPING INI (00-peta-data, 2026-11-05, MongoDB 8.0.1, companyCode WAG)
 *   - tbl_stok adalah ledger mutasi aplikasi. Jumlah dokumen & total qty-nya sama persis
 *     dengan transaksi sumber untuk MATERIALOUT (qtyKeluarOk), DELIVERY (jmlKeluarOk),
 *     PRODUCTION RESULT, TRANSFER, DEADSTOK, SCRAP. INCOMING selisih 10 dokumen.
 *     -> Mutasi dihitung dari ledger (sumber "stok", hitungMutasi: true).
 *   - Sumber lain dipakai untuk menelusuri dokumen asal tiap baris ledger (rujukan via idAsal),
 *     tidak ikut dihitung (hitungMutasi: false) supaya tidak dobel.
 *   - Tidak masuk ledger: barang masuk (dok BC; yang masuk ledger adalah incoming/GRN),
 *     receiving & konsumsi produksi (dilacak lewat counter qtyUse), penyesuaian
 *     (qtySesuai hampir semua 0; pengurangan stok dibuat sebagai material keluar).
 *
 * MASIH PERLU DIPASTIKAN (lihat kolom CEK di kartu stok 01-mutasi)
 *   - qty incoming yang dipakai ledger: qtyWh (asumsi) atau qty.
 *
 * FORMAT PER SUMBER
 *   label        : nama yang tampil di laporan
 *   koleksi      : nama koleksi transaksi
 *   arah         : 'IN' | 'OUT' | 'TANDA_QTY' | { field, dari: 'detail'|'header', nilai: { NILAI: 'IN'|'OUT' } }
 *   kategori     : bebas (informasi)
 *   hitungMutasi : true = ikut dihitung di saldo (default), false = hanya untuk penelusuran
 *   filter       : filter MongoDB tambahan untuk dokumen yang dihitung
 *   field        : { fieldLogis: 'namaFieldDiDokumen' }
 *                  wajib    : tanggal, companyCode, kodeBarang, qty
 *                  opsional : noTransaksi, idAsal, idDokumen, noAju, noReg, noUrut, jenisDokumen,
 *                             satuan, gudang, createdAt, asal, proses, dihapus
 *   header       : (opsional) field yang ada di koleksi header, lihat README
 *   rujukan      : (opsional, untuk ledger) { 'ASAL' atau 'ASAL:ARAH': 'namaSumber' }
 *                  idAsal baris ledger dicari ke _id koleksi sumber yang dirujuk
 *
 * MASTER BARANG
 *   master.field : kodeBarang (wajib), companyCode, nama, kategori, satuan
 *
 * DOKUMEN HITUNG FISIK (opname)
 *   opname.<nama>.field : kodeBarang, qty, tanggal (wajib), companyCode, noReg, noBap, satuan, nama
 *   opname.<nama>.desimal : (opsional) jumlah desimal qty dokumen; saldo buku dibulatkan sama sebelum dibandingkan
 *   MONSUS = monitoring khusus Bea Cukai, setara hasil opname tahunan.
 */
module.exports = {
  meta: {
    status: 'TERVERIFIKASI',
    catatan: 'Nama koleksi/field diverifikasi dengan profil schema & 00-peta-data erpgarment 2026-11-05. ' +
      'qty incoming (qtyWh) belum dicocokkan per dokumen.',
  },

  // Zona waktu untuk batas periode & tampilan tanggal (WIB)
  timezone: '+07:00',

  master: {
    koleksi: 'tbl_barang',
    field: {
      kodeBarang: 'kodeBarang',
      companyCode: 'companyCode',
      nama: 'namaBarang',
      kategori: 'jenisBc', // MATERIAL | BARANG SETENGAH JADI | BARANG JADI | MESIN | SCRAP
      satuan: 'satuan',
    },
  },

  // Dokumen hitung fisik untuk rekonsiliasi (02-rekon-opname)
  opname: {
    monsus: {
      label: 'Monitoring khusus Bea Cukai (hasil opname)',
      koleksi: 'tbl_monsusdetail',
      // qty MONSUS dibulatkan 2 desimal (rekon 2026-01: 32 kode beda <= 0,005 karena pembulatan)
      desimal: 2,
      field: {
        kodeBarang: 'kodeBarang',
        qty: 'qty',
        tanggal: 'tanggal', // 23:59:59 WIB tanggal opname
        companyCode: 'companyCode',
        noReg: 'noReg',
        noBap: 'noBap',
        satuan: 'satuan',
        nama: 'namaBarang',
      },
    },
    stokopname: {
      label: 'Stock opname',
      koleksi: 'tbl_stokopnamedetail',
      field: {
        kodeBarang: 'kodeBarang',
        qty: 'qtyOpname',
        tanggal: 'tglOpname',
        companyCode: 'companyCode',
        noReg: 'noReg',
        noBap: 'noBap',
        nama: 'namaBarang',
      },
    },
  },

  sumber: {
    // ------------------------------------------------------------ LEDGER (dihitung)
    stok: {
      label: 'Ledger stok',
      koleksi: 'tbl_stok',
      arah: { field: 'jenis', nilai: { IN: 'IN', OUT: 'OUT' } },
      field: {
        tanggal: 'tanggal',
        companyCode: 'companyCode',
        kodeBarang: 'kodeBarang',
        qty: 'qty',
        satuan: 'satuan',
        idAsal: 'idAsal',
        asal: 'asal', // INCOMING | MATERIALOUT | DELIVERY | PRODUCTION | TRANSFER | DEADSTOK | SCRAP
        proses: 'namaProses',
      },
      // Hasil relasi 00-peta-data: idAsal per asal menunjuk ke koleksi berikut (100%)
      rujukan: {
        INCOMING: 'incoming',
        MATERIALOUT: 'materialKeluar',
        DELIVERY: 'delivery',
        PRODUCTION: 'produksiHasil',
        TRANSFER: 'transferProduksi',
        'DEADSTOK:IN': 'deadstokMasuk',
        'DEADSTOK:OUT': 'deadstokKeluar',
        'SCRAP:IN': 'scrapMasuk',
        'SCRAP:OUT': 'scrapKeluar',
      },
    },

    // ---------------------------------------------- SUMBER TRANSAKSI (penelusuran)
    incoming: {
      label: 'Incoming (GRN)',
      koleksi: 'tbl_incomingdetail',
      arah: 'IN',
      hitungMutasi: false,
      field: {
        tanggal: 'tglMasuk',
        companyCode: 'companyCode',
        kodeBarang: 'kodeBarang',
        qty: 'qtyWh', // ASUMSI: ledger memakai qty gudang (qtyWh/satuanWh), bukan qty dokumen
        satuan: 'satuanWh',
        noTransaksi: 'noReg',
        idAsal: 'idAsal', // -> tbl_barangmasukdetail (dokumen BC)
        jenisDokumen: 'idDokumen',
        noAju: 'noAju',
        noUrut: 'noUrut',
        dihapus: 'isDeleted',
      },
    },

    materialKeluar: {
      label: 'Material keluar',
      koleksi: 'tbl_materialkeluardetail',
      arah: 'OUT',
      hitungMutasi: false,
      field: {
        tanggal: 'tglKeluar',
        companyCode: 'companyCode',
        kodeBarang: 'kodeMaterial', // kodeBarang di koleksi ini = kode barang jadi tujuan
        qty: 'qtyKeluarOk',
        satuan: 'satuanKeluarOk',
        noTransaksi: 'noReg',
        idAsal: 'idAsal', // -> tbl_incomingdetail (lot)
        jenisDokumen: 'idDokumen',
        noAju: 'noAju',
        noUrut: 'noUrut',
        dihapus: 'isDeleted',
      },
    },

    delivery: {
      label: 'Delivery',
      koleksi: 'tbl_deliverydetail',
      arah: 'OUT',
      hitungMutasi: false,
      field: {
        tanggal: 'tglKeluar',
        companyCode: 'companyCode',
        kodeBarang: 'kodeBarang',
        qty: 'jmlKeluarOk',
        satuan: 'satuan', // satuanKeluarOk hanya terisi sebagian kecil
        noTransaksi: 'noReg',
        idAsal: 'idAsal',
        jenisDokumen: 'idDokumen',
        noAju: 'noAju',
        noUrut: 'noUrut',
        dihapus: 'isDeleted',
      },
    },

    produksiHasil: {
      label: 'Hasil produksi',
      koleksi: 'tbl_productiondetail',
      arah: 'IN',
      hitungMutasi: false,
      filter: { info: { $in: ['result', 'scrap'] } },
      field: {
        tanggal: 'tanggal',
        companyCode: 'companyCode',
        kodeBarang: 'kodeBarang',
        qty: 'qty',
        satuan: 'satuan',
        noTransaksi: 'noReg',
        idAsal: 'idAsalProduksi',
        jenisDokumen: 'jenisDokumenBc',
        proses: 'namaProses',
        dihapus: 'isDeleted',
      },
    },

    transferProduksi: {
      label: 'Transfer antar proses',
      koleksi: 'tbl_transferproduction',
      arah: 'OUT',
      hitungMutasi: false,
      field: {
        tanggal: 'tanggal',
        companyCode: 'companyCode',
        kodeBarang: 'kodeBarang',
        qty: 'qty',
        satuan: 'satuan',
        noTransaksi: 'noReg',
        idAsal: 'idAsal', // -> tbl_productiondetail (hasil)
        jenisDokumen: 'jenisDokumenBc',
        proses: 'namaProses',
        dihapus: 'isDeleted',
      },
    },

    deadstokMasuk: {
      label: 'Deadstock (kode DS masuk)',
      koleksi: 'tbl_deadstokdetail',
      arah: 'IN',
      hitungMutasi: false,
      field: {
        tanggal: 'tanggal',
        companyCode: 'companyCode',
        kodeBarang: 'kodeBarang',
        qty: 'qty',
        satuan: 'satuan',
        noTransaksi: 'nomorLapor',
        idAsal: 'idAsalIncoming',
        jenisDokumen: 'idDokumen',
        noAju: 'noAju',
        noUrut: 'noUrut',
      },
    },

    deadstokKeluar: {
      label: 'Deadstock (kode asal keluar)',
      koleksi: 'tbl_deadstokdetail',
      arah: 'OUT',
      hitungMutasi: false,
      field: {
        tanggal: 'tanggal',
        companyCode: 'companyCode',
        kodeBarang: 'kodeBarangAsal',
        qty: 'qty',
        satuan: 'satuan',
        noTransaksi: 'nomorLapor',
        idAsal: 'idAsalIncoming',
        jenisDokumen: 'idDokumen',
        noAju: 'noAju',
        noUrut: 'noUrut',
      },
    },

    scrapMasuk: {
      label: 'Scrap masuk',
      koleksi: 'exim_scrapdetail',
      arah: 'IN',
      hitungMutasi: false,
      field: {
        tanggal: 'tanggal',
        companyCode: 'companyCode',
        kodeBarang: 'kodeBarang',
        qty: 'qty',
        satuan: 'satuan',
        noTransaksi: 'noReg',
        dihapus: 'isDeleted',
      },
    },

    scrapKeluar: {
      label: 'Scrap keluar (ex BC)',
      koleksi: 'exim_scrapexbc',
      arah: 'OUT',
      hitungMutasi: false,
      field: {
        tanggal: 'tanggal',
        companyCode: 'companyCode',
        kodeBarang: 'kodeBarang',
        qty: 'qty',
        satuan: 'satuan',
        noTransaksi: 'noReg',
        idAsal: 'idProduksi',
        dihapus: 'isDeleted',
      },
    },

    // Dokumen pabean pemasukan. Tidak masuk ledger (yang masuk ledger adalah incoming/GRN
    // yang merujuk ke sini lewat idAsal). Disimpan untuk pemeriksaan dok BC vs GRN.
    barangMasuk: {
      label: 'Barang masuk (dokumen BC)',
      koleksi: 'tbl_barangmasukdetail',
      arah: 'IN',
      hitungMutasi: false,
      filter: { isReceiv: true },
      field: {
        tanggal: 'tglPenerimaan',
        companyCode: 'companyCode',
        kodeBarang: 'kodeBarang',
        qty: 'qtyWh',
        satuan: 'satuanWh',
        noTransaksi: 'noReg',
        jenisDokumen: 'idDokumen',
        noAju: 'noAju',
        noUrut: 'noUrut',
        dihapus: 'isDeleted',
      },
    },
  },
};
