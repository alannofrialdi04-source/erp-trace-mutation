/*
 * ============================================================================
 *  ERP Trace Mutation | 01-mutasi | v0.6.0
 *  Mutasi stok per kode barang: rekap periode (saldo awal, masuk, keluar, saldo akhir) dan kartu stok
 * ----------------------------------------------------------------------------
 *  FILE HASIL BUILD. Yang boleh diedit hanya blok KONFIGURASI di bawah.
 *  Kode sumber: src/tools/01-mutasi.js | mapping: config/mapping.js
 *  Setelah mengubah sumber/mapping jalankan `npm run build`.
 *
 *  Cara pakai:
 *    mongosh "<connection-string>/<database>" --file dist/01-mutasi.js
 *    atau di dalam mongosh : load("dist/01-mutasi.js")
 *    atau paste seluruh isi file ini ke shell.
 *  Hasil lengkap tersimpan di variabel TRACE_HASIL.
 *
 *  READ-ONLY: script ini hanya membaca data (find / aggregate).
 * ============================================================================
 */
var TRACE_HASIL = (function () {
'use strict';

// ======================= KONFIGURASI (silakan edit) =========================
var CONFIG = {
  // 'rekap' = ringkasan per kode barang | 'kartu' = kartu stok per transaksi dengan saldo berjalan
  MODE: 'rekap',

  // Filter companyCode. null = semua company (TIDAK disarankan: satu DB berisi beberapa company)
  COMPANY_CODE: 'WAG',

  // Periode laporan (zona waktu dari MAPPING.timezone, batas atas eksklusif)
  // '2026-01' | '2026' | '2026-01-15' | { dari: '2026-01-01', sampai: '2026-01-15' }
  PERIODE: '2026-01',

  // Kode barang: 'ABC' | ['ABC', 'DEF']. Wajib untuk MODE 'kartu' (maks 20 kode).
  KODE_BARANG: null,

  // Rekap: batasi ke kategori master barang (MAPPING.master.field.kategori), mis. 'MATERIAL', 'BARANG JADI'
  KATEGORI: null,

  // Transaksi sebelum tanggal ini ditandai SEBELUM_CUTOFF (tetap dihitung). null = tidak dicek.
  TANGGAL_CUTOFF: '2025-08-18',

  // Kapan saldo dinilai minus:
  //   'hari'      = saldo AKHIR HARI (minus sesaat karena urutan jam input diberi tanda MINUS_SESAAT)
  //   'transaksi' = setelah setiap transaksi
  MINUS_PER: 'hari',

  // Rekap: hanya tampilkan kode yang punya tanda masalah
  HANYA_BERMASALAH: false,

  // Rekap: maksimal baris di output teks (FORMAT 'json' selalu lengkap)
  TAMPIL_MAKS: 200,

  // Kartu: maksimal baris transaksi per kode
  KARTU_MAKS_BARIS: 2000,

  // Kartu: cocokkan tiap baris dengan dokumen sumbernya (MAPPING.sumber.*.rujukan)
  CEK_SUMBER: true,

  // Database: null = database aktif di koneksi
  DB: null,

  // 'teks' | 'json'
  FORMAT: 'teks',
};

// =================== MAPPING (dari config/mapping.js) ========================
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
var MAPPING = {
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

// =============================== LIB =========================================
// ---- src/lib/tanggal.js ----
/**
 * Helper tanggal berbasis zona waktu lokal (default WIB = +07:00).
 *
 * MongoDB menyimpan Date dalam UTC. Batas periode dihitung dari tengah malam
 * waktu lokal, dengan batas atas EKSKLUSIF. Contoh November 2026 (WIB):
 *   { $gte: 2026-10-31T17:00:00Z, $lt: 2026-11-30T17:00:00Z }
 */

var TZ_DEFAULT = '+07:00';

function offsetMenit(tz) {
  var m = /^([+-])(\d{2}):(\d{2})$/.exec(String(tz));
  if (!m) {
    throw new Error('Format timezone tidak valid: "' + tz + '" (contoh yang benar: "+07:00")');
  }
  var jam = parseInt(m[2], 10);
  var menit = parseInt(m[3], 10);
  if (menit > 59 || jam * 60 + menit > 14 * 60) {
    throw new Error('Timezone di luar jangkauan: "' + tz + '"');
  }
  var total = jam * 60 + menit;
  return m[1] === '-' ? -total : total;
}

function labelZona(tz) {
  if (tz === '+07:00') return 'WIB';
  if (tz === '+08:00') return 'WITA';
  if (tz === '+09:00') return 'WIT';
  return 'UTC' + tz;
}

function _duaDigit(n) {
  return (n < 10 ? '0' : '') + n;
}

function _uraiTanggal(teks) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(teks));
  if (!m) throw new Error('Format tanggal harus YYYY-MM-DD: "' + teks + '"');
  var y = parseInt(m[1], 10);
  var bln = parseInt(m[2], 10);
  var hr = parseInt(m[3], 10);
  var cek = new Date(Date.UTC(y, bln - 1, hr));
  if (cek.getUTCFullYear() !== y || cek.getUTCMonth() !== bln - 1 || cek.getUTCDate() !== hr) {
    throw new Error('Tanggal tidak valid: "' + teks + '"');
  }
  return { y: y, bln: bln, hr: hr };
}

function _isoTanggalUTC(d) {
  return d.getUTCFullYear() + '-' + _duaDigit(d.getUTCMonth() + 1) + '-' + _duaDigit(d.getUTCDate());
}

/** 'YYYY-MM-DD' (tanggal lokal) -> Date (UTC) saat pukul 00:00 waktu lokal */
function awalHariLokal(teks, tz) {
  var t = _uraiTanggal(teks);
  return new Date(Date.UTC(t.y, t.bln - 1, t.hr) - offsetMenit(tz || TZ_DEFAULT) * 60000);
}

/** Geser tanggal 'YYYY-MM-DD' sebanyak n hari, hasil tetap 'YYYY-MM-DD' */
function geserHari(teks, n) {
  var t = _uraiTanggal(teks);
  return _isoTanggalUTC(new Date(Date.UTC(t.y, t.bln - 1, t.hr + n)));
}

/**
 * Ubah periode jadi rentang Date dengan batas atas eksklusif.
 *   '2026-11'                                -> satu bulan
 *   '2026'                                   -> satu tahun
 *   '2026-11-05'                             -> satu hari
 *   { dari: '2026-11-01', sampai: '2026-11-15' } -> sampai INKLUSIF
 */
function rentangPeriode(periode, tz) {
  tz = tz || TZ_DEFAULT;
  offsetMenit(tz);
  var dari;
  var sampaiEksklusif;
  var m;
  var teks = String(periode);

  if (periode && typeof periode === 'object') {
    if (!periode.dari || !periode.sampai) {
      throw new Error('Periode berbentuk objek wajib punya "dari" dan "sampai" (YYYY-MM-DD)');
    }
    dari = String(periode.dari);
    _uraiTanggal(dari);
    sampaiEksklusif = geserHari(String(periode.sampai), 1);
    if (sampaiEksklusif <= dari) {
      throw new Error('Periode tidak valid: "sampai" (' + periode.sampai + ') lebih awal dari "dari" (' + dari + ')');
    }
  } else if ((m = /^(\d{4})$/.exec(teks))) {
    dari = m[1] + '-01-01';
    sampaiEksklusif = (parseInt(m[1], 10) + 1) + '-01-01';
  } else if ((m = /^(\d{4})-(\d{2})$/.exec(teks))) {
    var y = parseInt(m[1], 10);
    var bln = parseInt(m[2], 10);
    if (bln < 1 || bln > 12) throw new Error('Bulan tidak valid pada periode "' + teks + '"');
    dari = m[1] + '-' + m[2] + '-01';
    sampaiEksklusif = bln === 12 ? (y + 1) + '-01-01' : y + '-' + _duaDigit(bln + 1) + '-01';
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(teks)) {
    dari = teks;
    sampaiEksklusif = geserHari(dari, 1);
  } else {
    throw new Error(
      'Format periode tidak dikenal: ' + JSON.stringify(periode) +
      ' (pakai "2026-11", "2026", "2026-11-05", atau { dari: "2026-11-01", sampai: "2026-11-15" })'
    );
  }

  var sampai = geserHari(sampaiEksklusif, -1);
  return {
    gte: awalHariLokal(dari, tz),
    lt: awalHariLokal(sampaiEksklusif, tz),
    dari: dari,
    sampai: sampai,
    tz: tz,
    label: dari + ' s/d ' + sampai + ' (' + labelZona(tz) + ')',
  };
}

function _geserKeLokal(date, tz) {
  return new Date(date.getTime() + offsetMenit(tz || TZ_DEFAULT) * 60000);
}

function _tanggalValid(d) {
  return d instanceof Date && !isNaN(d.getTime());
}

/** Date -> 'YYYY-MM-DD HH:mm:ss' (atau 'YYYY-MM-DD' bila denganJam === false) di zona lokal */
function formatLokal(date, tz, denganJam) {
  if (!_tanggalValid(date)) return String(date);
  var d = _geserKeLokal(date, tz);
  var tgl = _isoTanggalUTC(d);
  if (denganJam === false) return tgl;
  return tgl + ' ' + _duaDigit(d.getUTCHours()) + ':' + _duaDigit(d.getUTCMinutes()) + ':' + _duaDigit(d.getUTCSeconds());
}

/** Date -> 'HH:mm' di zona lokal */
function jamLokal(date, tz) {
  if (!_tanggalValid(date)) return null;
  var d = _geserKeLokal(date, tz);
  return _duaDigit(d.getUTCHours()) + ':' + _duaDigit(d.getUTCMinutes());
}

/**
 * Dugaan salah ketik tahun dari selisih hari (tanggal transaksi - tanggal registrasi).
 * Hasil: jumlah tahun yang perlu ditambahkan ke tanggal transaksi (mis. 1 untuk 2024 -> 2025),
 * negatif bila tanggal kelebihan tahun, atau 0 bila bukan pola salah tahun.
 * Pola salah tahun = selisih hampir tepat kelipatan 365,25 hari (sisa <= batasHari).
 */
function dugaanSalahTahun(selisihHari, batasHari) {
  var tahun = Math.round(Math.abs(selisihHari) / 365.25);
  if (tahun < 1) return 0;
  if (Math.abs(Math.abs(selisihHari) - tahun * 365.25) > batasHari) return 0;
  return selisihHari < 0 ? tahun : -tahun;
}

/** 'YYYY-MM-DD' digeser n tahun; null bila tanggal hasilnya tidak ada (mis. 29 Februari) */
function geserTahun(teks, n) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(teks));
  if (!m) return null;
  var hasil = (parseInt(m[1], 10) + n) + '-' + m[2] + '-' + m[3];
  try {
    _uraiTanggal(hasil);
    return hasil;
  } catch (e) {
    return null;
  }
}

// ---- src/lib/teks.js ----
/**
 * Helper teks: penyamaran nilai (pola) dan pencarian nama yang mirip.
 */

var POLA_HEX24 = /^[0-9a-f]{24}$/i;
var POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Samarkan string jadi pola: A = huruf besar, a = huruf kecil, 9 = angka,
 * karakter lain (termasuk spasi) dipertahankan.
 *   'PT-ABC/2024/001' -> 'AA-AAA/9999/999'
 */
function polaString(s, maks) {
  s = String(s);
  maks = maks || 40;
  if (s === '') return '<kosong>';
  if (/^\s+$/.test(s)) return '<spasi>';
  if (POLA_HEX24.test(s)) return '<hex24>';
  if (POLA_UUID.test(s)) return '<uuid>';
  var hasil = '';
  for (var i = 0; i < s.length && i < maks; i++) {
    var c = s.charAt(i);
    if (c >= 'A' && c <= 'Z') hasil += 'A';
    else if (c >= 'a' && c <= 'z') hasil += 'a';
    else if (c >= '0' && c <= '9') hasil += '9';
    else hasil += c;
  }
  if (s.length > maks) hasil += '...(' + s.length + ' karakter)';
  return hasil;
}

function punyaSpasiTepi(s) {
  return typeof s === 'string' && s.length > 0 && s !== s.trim();
}

function jarakLevenshtein(a, b) {
  a = String(a);
  b = String(b);
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  var sebelum = [];
  var j;
  for (j = 0; j <= b.length; j++) sebelum.push(j);
  for (var i = 1; i <= a.length; i++) {
    var sekarang = [i];
    for (j = 1; j <= b.length; j++) {
      var biaya = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      sekarang.push(Math.min(sekarang[j - 1] + 1, sebelum[j] + 1, sebelum[j - 1] + biaya));
    }
    sebelum = sekarang;
  }
  return sebelum[b.length];
}

function _normalNama(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Cari nama yang mirip (mis. nama koleksi salah ketik / beda huruf besar-kecil) */
function kandidatNama(nama, daftar, maks) {
  var n = _normalNama(nama);
  var calon = [];
  for (var i = 0; i < daftar.length; i++) {
    var k = daftar[i];
    if (k === nama) continue;
    var nk = _normalNama(k);
    var skor = null;
    if (nk === n) {
      skor = 0;
    } else if (n.length >= 4 && nk.length >= 4 && (nk.indexOf(n) >= 0 || n.indexOf(nk) >= 0)) {
      skor = 1;
    } else {
      var jarak = jarakLevenshtein(n, nk);
      if (jarak <= Math.max(2, Math.floor(n.length / 5))) skor = 1 + jarak;
    }
    if (skor !== null) calon.push({ nama: k, skor: skor });
  }
  calon.sort(function (x, y) {
    return x.skor - y.skor || (x.nama < y.nama ? -1 : x.nama > y.nama ? 1 : 0);
  });
  var hasil = [];
  for (var c = 0; c < calon.length && c < (maks || 5); c++) hasil.push(calon[c].nama);
  return hasil;
}

/** Ambil n entri teratas dari objek hitungan { kunci: jumlah } */
function teratas(hitungan, n) {
  var daftar = [];
  for (var k in hitungan) {
    if (Object.prototype.hasOwnProperty.call(hitungan, k)) daftar.push({ nilai: k, jumlah: hitungan[k] });
  }
  daftar.sort(function (a, b) {
    return b.jumlah - a.jumlah || (a.nilai < b.nilai ? -1 : a.nilai > b.nilai ? 1 : 0);
  });
  return n ? daftar.slice(0, n) : daftar;
}

// ---- src/lib/tabel.js ----
/**
 * Helper tampilan teks: format angka (gaya Indonesia) dan tabel kolom rata.
 */

function padKanan(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}

function padKiri(s, n) {
  s = String(s);
  while (s.length < n) s = ' ' + s;
  return s;
}

function potong(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, Math.max(0, n - 3)) + '...' : s;
}

/**
 * Format angka gaya Indonesia: 12345.5 -> '12.345,5'
 * desimal: jumlah angka di belakang koma, atau 'auto' (maks 4, nol di belakang dibuang)
 */
function fmtAngka(n, desimal) {
  if (n === null || n === undefined || typeof n !== 'number' || isNaN(n)) return '-';
  var negatif = n < 0;
  var s;
  if (desimal === 'auto') {
    s = Math.abs(n).toFixed(4).replace(/\.?0+$/, '');
  } else {
    s = Math.abs(n).toFixed(desimal || 0);
  }
  var bagian = s.split('.');
  var bulat = bagian[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  var hasil = bagian.length > 1 ? bulat + ',' + bagian[1] : bulat;
  if (negatif && hasil.replace(/[0.,]/g, '') !== '') hasil = '-' + hasil;
  return hasil;
}

/** Persentase gaya Indonesia: (1, 3) -> '33,3%' */
function fmtPersen(bagian, total) {
  if (!total) return '-';
  var p = (bagian / total) * 100;
  if (p === 0 || p === 100) return p + '%';
  if (p < 0.1) return '<0,1%';
  if (p > 99.9) return '>99,9%';
  return fmtAngka(Math.round(p * 10) / 10, 'auto') + '%';
}

/**
 * Susun tabel teks.
 *   kolom : [{ judul, kunci, kanan: bool, maks: number }]
 *   baris : array objek
 * Kolom terakhir tidak di-pad (boleh panjang). Hasil: array baris teks.
 */
function formatTabel(kolom, baris) {
  var lebar = [];
  var i;
  var j;
  for (j = 0; j < kolom.length; j++) lebar.push(kolom[j].judul.length);
  var sel = [];
  for (i = 0; i < baris.length; i++) {
    var satu = [];
    for (j = 0; j < kolom.length; j++) {
      var v = baris[i][kolom[j].kunci];
      v = v === null || v === undefined ? '' : String(v);
      if (kolom[j].maks) v = potong(v, kolom[j].maks);
      if (v.length > lebar[j]) lebar[j] = v.length;
      satu.push(v);
    }
    sel.push(satu);
  }
  function susun(isi) {
    var bagian = [];
    for (var k = 0; k < isi.length; k++) {
      if (k === isi.length - 1) bagian.push(isi[k]);
      else bagian.push(kolom[k].kanan ? padKiri(isi[k], lebar[k]) : padKanan(isi[k], lebar[k]));
    }
    return bagian.join('  ').replace(/\s+$/, '');
  }
  var judul = [];
  var garis = [];
  for (j = 0; j < kolom.length; j++) {
    judul.push(kolom[j].judul);
    garis.push(new Array(lebar[j] + 1).join('-'));
  }
  var hasil = [susun(judul), susun(garis)];
  for (i = 0; i < sel.length; i++) hasil.push(susun(sel[i]));
  return hasil;
}

// ---- src/lib/bson.js ----
/**
 * Helper tipe data BSON di sisi klien (mongosh).
 *
 * Catatan: mongosh mengembalikan Int32 dan Double sama-sama sebagai number JS,
 * jadi di sisi klien keduanya dilaporkan 'int/double'. Tipe persis diambil dari
 * operator $type di server bila memungkinkan.
 */

var TIPE_ANGKA = ['double', 'int', 'long', 'decimal', 'int/double'];

function tipeNilai(v) {
  if (v === undefined) return 'missing';
  if (v === null) return 'null';
  if (v instanceof Date) return 'date';
  if (Array.isArray(v)) return 'array';
  var t = typeof v;
  if (t === 'number') return 'int/double';
  if (t === 'string') return 'string';
  if (t === 'boolean') return 'bool';
  if (t === 'object') {
    var bt = v._bsontype;
    if (bt === 'ObjectId' || bt === 'ObjectID') return 'objectId';
    if (bt === 'Decimal128') return 'decimal';
    if (bt === 'Long') return 'long';
    if (bt === 'Int32') return 'int';
    if (bt === 'Double') return 'double';
    if (bt === 'Timestamp') return 'timestamp';
    if (bt === 'Binary') return 'binData';
    if (bt === 'BSONRegExp' || v instanceof RegExp) return 'regex';
    if (bt) return String(bt).toLowerCase();
    return 'object';
  }
  return t;
}

function tipeAngka(tipe) {
  return TIPE_ANGKA.indexOf(tipe) >= 0;
}

/** Nilai angka BSON apa pun -> number JS (atau null bila bukan angka) */
function angkaDariNilai(v) {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && v._bsontype) {
    if (v._bsontype === 'Long' && typeof v.toNumber === 'function') return v.toNumber();
    if (v._bsontype === 'Decimal128') return parseFloat(v.toString());
    if (v._bsontype === 'Int32' || v._bsontype === 'Double') return Number(v.valueOf());
  }
  return null;
}

/** Ubah nilai (termasuk tipe BSON) jadi bentuk yang aman untuk JSON.stringify */
function keJSONAman(v) {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
  if (Array.isArray(v)) {
    var arr = [];
    for (var i = 0; i < v.length; i++) arr.push(keJSONAman(v[i]));
    return arr;
  }
  if (typeof v === 'object') {
    var bt = v._bsontype;
    if (bt === 'ObjectId' || bt === 'ObjectID') return v.toHexString();
    if (bt === 'Decimal128' || bt === 'Long') return v.toString();
    if (bt === 'Int32' || bt === 'Double') return Number(v.valueOf());
    if (bt) return String(v);
    var o = {};
    for (var k in v) {
      if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = keJSONAman(v[k]);
    }
    return o;
  }
  if (typeof v === 'number' && !isFinite(v)) return String(v);
  return v;
}

// ---- src/lib/mapping.js ----
/**
 * Definisi field logis + validasi struktur MAPPING (config/mapping.js).
 */


var FIELD_WAJIB = ['tanggal', 'companyCode', 'kodeBarang', 'qty'];
var FIELD_OPSIONAL = [
  'noTransaksi', 'idAsal', 'idDokumen', 'noAju', 'noReg', 'noUrut',
  'jenisDokumen', 'satuan', 'gudang', 'createdAt',
  // asal = modul asal transaksi (mis. tbl_stok.asal), proses = lokasi/proses produksi,
  // dihapus = penanda soft delete (mis. isDeleted)
  'asal', 'proses', 'dihapus',
];
var ARAH_STATIS = ['IN', 'OUT', 'TANDA_QTY'];
var KONVERSI_LINK = ['toObjectId', 'toString'];
var KUNCI_SUMBER = ['label', 'koleksi', 'arah', 'kategori', 'hitungMutasi', 'filter', 'field', 'header', 'rujukan'];
var KUNCI_MAPPING = ['meta', 'timezone', 'sumber', 'master', 'opname'];
var FIELD_OPNAME_WAJIB = ['kodeBarang', 'qty', 'tanggal'];
var FIELD_OPNAME_OPSIONAL = ['companyCode', 'noReg', 'noBap', 'satuan', 'nama'];
var FIELD_MASTER_WAJIB = ['kodeBarang'];
var FIELD_MASTER_OPSIONAL = ['companyCode', 'nama', 'kategori', 'satuan'];
var KUNCI_HEADER = ['koleksi', 'localField', 'foreignField', 'konversi', 'filter', 'field'];

function _objekBiasa(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

function _teksIsi(v) {
  return typeof v === 'string' && v.trim() !== '';
}

function normalKunciArah(s) {
  return String(s).trim().toUpperCase();
}

/** Lokasi field logis pada sumber: { lokasi: 'detail' | 'header', path } atau null */
function lokasiField(sumber, logis) {
  if (sumber.field && _teksIsi(sumber.field[logis])) {
    return { lokasi: 'detail', path: sumber.field[logis] };
  }
  if (sumber.header && sumber.header.field && _teksIsi(sumber.header.field[logis])) {
    return { lokasi: 'header', path: sumber.header.field[logis] };
  }
  return null;
}

/** Daftar unik koleksi (detail + header) yang disebut di MAPPING */
function daftarKoleksiMapping(mapping) {
  var hasil = [];
  if (!mapping || !_objekBiasa(mapping.sumber)) return hasil;
  var kunci = Object.keys(mapping.sumber);
  for (var i = 0; i < kunci.length; i++) {
    var s = mapping.sumber[kunci[i]];
    if (!_objekBiasa(s)) continue;
    if (_teksIsi(s.koleksi) && hasil.indexOf(s.koleksi) < 0) hasil.push(s.koleksi);
    if (_objekBiasa(s.header) && _teksIsi(s.header.koleksi) && hasil.indexOf(s.header.koleksi) < 0) {
      hasil.push(s.header.koleksi);
    }
  }
  if (_objekBiasa(mapping.master) && _teksIsi(mapping.master.koleksi) && hasil.indexOf(mapping.master.koleksi) < 0) {
    hasil.push(mapping.master.koleksi);
  }
  return hasil;
}

/**
 * Sumber yang dirujuk oleh baris ledger, berdasarkan nilai asal & arah.
 * Kunci 'ASAL:ARAH' didahulukan, lalu 'ASAL'. Hasil: nama sumber atau null.
 */
function sumberRujukan(sumber, asal, arah) {
  if (!sumber || !_objekBiasa(sumber.rujukan) || asal === null || asal === undefined) return null;
  var kunciLengkap = String(asal) + ':' + String(arah);
  if (_teksIsi(sumber.rujukan[kunciLengkap])) return sumber.rujukan[kunciLengkap];
  if (_teksIsi(sumber.rujukan[String(asal)])) return sumber.rujukan[String(asal)];
  return null;
}

function _validasiRujukan(mapping, err) {
  var kunci = Object.keys(mapping.sumber);
  for (var i = 0; i < kunci.length; i++) {
    var s = mapping.sumber[kunci[i]];
    if (!_objekBiasa(s) || s.rujukan === undefined || s.rujukan === null) continue;
    var p = 'sumber.' + kunci[i] + '.rujukan';
    if (!_objekBiasa(s.rujukan) || Object.keys(s.rujukan).length === 0) {
      err(p, 'harus berupa objek { nilaiAsal: "namaSumber" } yang tidak kosong');
      continue;
    }
    if (!lokasiField(s, 'idAsal')) err(p, 'rujukan butuh field "idAsal" dipetakan di sumber ini');
    if (!lokasiField(s, 'asal')) err(p, 'rujukan butuh field "asal" dipetakan di sumber ini');
    var kr = Object.keys(s.rujukan);
    for (var j = 0; j < kr.length; j++) {
      var tujuan = s.rujukan[kr[j]];
      if (!_teksIsi(tujuan) || !_objekBiasa(mapping.sumber[tujuan])) {
        err(p + '.' + kr[j], 'menunjuk ke sumber "' + tujuan + '" yang tidak ada di MAPPING.sumber');
      } else if (tujuan === kunci[i]) {
        err(p + '.' + kr[j], 'tidak boleh merujuk ke dirinya sendiri');
      }
    }
  }
}

function _validasiMaster(master, err, warn) {
  var p = 'master';
  if (!_objekBiasa(master)) {
    err(p, 'harus berupa objek { koleksi, field }');
    return;
  }
  _kunciAsing(p, master, ['koleksi', 'field'], warn);
  if (!_teksIsi(master.koleksi)) err(p + '.koleksi', 'wajib diisi nama koleksi master barang');
  if (!_objekBiasa(master.field)) {
    err(p + '.field', 'wajib berupa objek { kodeBarang, companyCode, nama, kategori, satuan }');
    return;
  }
  var dikenal = FIELD_MASTER_WAJIB.concat(FIELD_MASTER_OPSIONAL);
  var kf = Object.keys(master.field);
  for (var i = 0; i < kf.length; i++) {
    if (dikenal.indexOf(kf[i]) < 0) warn(p + '.field.' + kf[i], 'field master tidak dikenal. Yang dikenal: ' + dikenal.join(', '));
    else if (!_teksIsi(master.field[kf[i]])) err(p + '.field.' + kf[i], 'harus berupa nama field (teks)');
  }
  for (var j = 0; j < FIELD_MASTER_WAJIB.length; j++) {
    if (!_teksIsi(master.field[FIELD_MASTER_WAJIB[j]])) err(p + '.field.' + FIELD_MASTER_WAJIB[j], 'wajib diisi');
  }
}

function _validasiOpname(opname, err, warn) {
  if (!_objekBiasa(opname) || Object.keys(opname).length === 0) {
    err('opname', 'harus berupa objek { namaDokumen: { koleksi, field } } yang tidak kosong');
    return;
  }
  var kunci = Object.keys(opname);
  var dikenal = FIELD_OPNAME_WAJIB.concat(FIELD_OPNAME_OPSIONAL);
  for (var i = 0; i < kunci.length; i++) {
    var p = 'opname.' + kunci[i];
    var o = opname[kunci[i]];
    if (!_objekBiasa(o)) {
      err(p, 'harus berupa objek { label, koleksi, field }');
      continue;
    }
    _kunciAsing(p, o, ['label', 'koleksi', 'field', 'desimal'], warn);
    if (!_teksIsi(o.koleksi)) err(p + '.koleksi', 'wajib diisi nama koleksi');
    if (o.desimal !== undefined && o.desimal !== null &&
        (typeof o.desimal !== 'number' || Math.floor(o.desimal) !== o.desimal || o.desimal < 0 || o.desimal > 6)) {
      err(p + '.desimal', 'harus bilangan bulat 0-6 (jumlah desimal qty di dokumen opname)');
    }
    if (!_objekBiasa(o.field)) {
      err(p + '.field', 'wajib berupa objek { kodeBarang, qty, tanggal, ... }');
      continue;
    }
    var kf = Object.keys(o.field);
    for (var j = 0; j < kf.length; j++) {
      if (dikenal.indexOf(kf[j]) < 0) warn(p + '.field.' + kf[j], 'field opname tidak dikenal. Yang dikenal: ' + dikenal.join(', '));
      else if (!_teksIsi(o.field[kf[j]])) err(p + '.field.' + kf[j], 'harus berupa nama field (teks)');
    }
    for (var w = 0; w < FIELD_OPNAME_WAJIB.length; w++) {
      if (!_teksIsi(o.field[FIELD_OPNAME_WAJIB[w]])) err(p + '.field.' + FIELD_OPNAME_WAJIB[w], 'wajib diisi');
    }
  }
}

/** Deskripsi singkat arah untuk laporan */
function ringkasArah(arah) {
  if (typeof arah === 'string') return arah;
  if (_objekBiasa(arah) && _objekBiasa(arah.nilai)) {
    var bagian = [];
    var kunci = Object.keys(arah.nilai);
    for (var i = 0; i < kunci.length; i++) bagian.push(kunci[i] + '->' + arah.nilai[kunci[i]]);
    return 'dari field ' + (arah.dari === 'header' ? 'header.' : '') + arah.field + ' (' + bagian.join(', ') + ')';
  }
  return String(arah);
}

function _validasiPetaField(path, peta, err, warn) {
  var kunci = Object.keys(peta);
  for (var i = 0; i < kunci.length; i++) {
    var f = kunci[i];
    var v = peta[f];
    if (FIELD_WAJIB.indexOf(f) < 0 && FIELD_OPSIONAL.indexOf(f) < 0) {
      warn(path + '.' + f, 'field logis "' + f + '" tidak dikenal dan diabaikan. Yang dikenal: ' +
        FIELD_WAJIB.concat(FIELD_OPSIONAL).join(', '));
      continue;
    }
    if (v === null) continue;
    if (!_teksIsi(v)) err(path + '.' + f, 'harus berupa nama field (teks)');
    else if (v.charAt(0) === '$') err(path + '.' + f, 'tulis nama field tanpa awalan "$"');
  }
}

function _kunciAsing(path, obj, dikenal, warn) {
  var kunci = Object.keys(obj);
  for (var i = 0; i < kunci.length; i++) {
    if (dikenal.indexOf(kunci[i]) < 0) {
      warn(path + '.' + kunci[i], 'properti tidak dikenal (salah ketik?). Yang dikenal: ' + dikenal.join(', '));
    }
  }
}

function _validasiArah(p, s, err) {
  var a = s.arah;
  if (typeof a === 'string') {
    if (ARAH_STATIS.indexOf(a) < 0) err(p + '.arah', 'pilihan: "IN", "OUT", "TANDA_QTY", atau { field, nilai }');
    return;
  }
  if (!_objekBiasa(a)) {
    err(p + '.arah', 'wajib diisi: "IN", "OUT", "TANDA_QTY", atau { field, nilai }');
    return;
  }
  if (!_teksIsi(a.field)) err(p + '.arah.field', 'wajib diisi nama field penentu arah');
  var dari = a.dari === undefined ? 'detail' : a.dari;
  if (dari !== 'detail' && dari !== 'header') err(p + '.arah.dari', 'pilihan: "detail" atau "header"');
  if (dari === 'header' && !_objekBiasa(s.header)) err(p + '.arah.dari', 'arah diambil dari header, tapi header belum didefinisikan');
  if (!_objekBiasa(a.nilai) || Object.keys(a.nilai).length === 0) {
    err(p + '.arah.nilai', 'wajib berupa objek { nilaiDiData: "IN" | "OUT" }');
    return;
  }
  var sudah = {};
  var kunci = Object.keys(a.nilai);
  for (var i = 0; i < kunci.length; i++) {
    var v = a.nilai[kunci[i]];
    if (v !== 'IN' && v !== 'OUT') err(p + '.arah.nilai.' + kunci[i], 'harus "IN" atau "OUT"');
    var nk = normalKunciArah(kunci[i]);
    if (sudah[nk] !== undefined && sudah[nk] !== v) {
      err(p + '.arah.nilai', 'nilai "' + kunci[i] + '" bentrok dengan nilai lain setelah dinormalisasi (trim + huruf besar)');
    }
    sudah[nk] = v;
  }
}

function _validasiHeader(p, h, err, warn) {
  var ph = p + '.header';
  if (!_objekBiasa(h)) {
    err(ph, 'harus berupa objek');
    return {};
  }
  _kunciAsing(ph, h, KUNCI_HEADER, warn);
  if (!_teksIsi(h.koleksi)) err(ph + '.koleksi', 'wajib diisi nama koleksi header');
  if (!_teksIsi(h.localField)) err(ph + '.localField', 'wajib diisi (field di detail yang menunjuk ke header)');
  if (h.foreignField !== undefined && !_teksIsi(h.foreignField)) err(ph + '.foreignField', 'harus berupa nama field (default "_id")');
  if (h.konversi !== undefined && h.konversi !== null && KONVERSI_LINK.indexOf(h.konversi) < 0) {
    err(ph + '.konversi', 'pilihan: "toObjectId", "toString", atau null');
  }
  if (h.filter !== undefined && h.filter !== null) {
    if (!_objekBiasa(h.filter)) {
      err(ph + '.filter', 'harus berupa objek');
    } else {
      var kf = Object.keys(h.filter);
      for (var i = 0; i < kf.length; i++) {
        if (kf[i].charAt(0) === '$') {
          err(ph + '.filter', 'operator level atas ("' + kf[i] + '") belum didukung di filter header; tulis kondisi per field');
        }
      }
    }
  }
  if (!_objekBiasa(h.field)) {
    err(ph + '.field', 'wajib berupa objek { fieldLogis: "namaFieldDiHeader" }');
    return {};
  }
  _validasiPetaField(ph + '.field', h.field, err, warn);
  return h.field;
}

function _validasiSumber(kunci, s, err, warn) {
  var p = 'sumber.' + kunci;
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(kunci)) err(p, 'nama sumber hanya boleh huruf, angka, dan _ (diawali huruf)');
  if (!_objekBiasa(s)) {
    err(p, 'definisi sumber harus berupa objek');
    return;
  }
  _kunciAsing(p, s, KUNCI_SUMBER, warn);
  if (!_teksIsi(s.koleksi)) err(p + '.koleksi', 'wajib diisi nama koleksi');
  if (s.filter !== undefined && s.filter !== null && !_objekBiasa(s.filter)) err(p + '.filter', 'harus berupa objek filter MongoDB');
  if (s.hitungMutasi !== undefined && typeof s.hitungMutasi !== 'boolean') err(p + '.hitungMutasi', 'harus true atau false');
  if (s.kategori !== undefined && s.kategori !== null && typeof s.kategori !== 'string') err(p + '.kategori', 'harus berupa teks');
  if (s.label !== undefined && typeof s.label !== 'string') err(p + '.label', 'harus berupa teks');

  var field = s.field;
  if (!_objekBiasa(field)) {
    err(p + '.field', 'wajib berupa objek { fieldLogis: "namaFieldDiDokumen" }');
    field = {};
  } else {
    _validasiPetaField(p + '.field', field, err, warn);
  }

  var hField = {};
  if (s.header !== undefined && s.header !== null) hField = _validasiHeader(p, s.header, err, warn);

  for (var i = 0; i < FIELD_WAJIB.length; i++) {
    var f = FIELD_WAJIB[i];
    if (!_teksIsi(field[f]) && !_teksIsi(hField[f])) {
      err(p + '.field.' + f, 'field wajib "' + f + '" belum dipetakan (di field atau header.field)');
    }
  }
  var kh = Object.keys(hField);
  for (var j = 0; j < kh.length; j++) {
    if (field[kh[j]] !== undefined && field[kh[j]] !== null && hField[kh[j]] !== null) {
      err(p + '.header.field.' + kh[j], '"' + kh[j] + '" dipetakan di detail dan header sekaligus; pilih salah satu');
    }
  }

  _validasiArah(p, s, err);
}

/**
 * Validasi struktur mapping. Tidak menyentuh database.
 * Hasil: { error: [{ path, pesan }], peringatan: [{ path, pesan }] }
 */
function validasiMapping(mapping) {
  var error = [];
  var peringatan = [];
  function err(path, pesan) { error.push({ path: path, pesan: pesan }); }
  function warn(path, pesan) { peringatan.push({ path: path, pesan: pesan }); }

  if (!_objekBiasa(mapping)) {
    err('mapping', 'MAPPING harus berupa objek');
    return { error: error, peringatan: peringatan };
  }
  var status = mapping.meta ? mapping.meta.status : undefined;
  if (status !== 'ASUMSI' && status !== 'TERVERIFIKASI') {
    warn('meta.status', 'isi dengan "ASUMSI" atau "TERVERIFIKASI"');
  }
  if (mapping.timezone !== undefined) {
    try {
      offsetMenit(mapping.timezone);
    } catch (e) {
      err('timezone', e.message);
    }
  }
  if (!_objekBiasa(mapping.sumber) || Object.keys(mapping.sumber).length === 0) {
    err('sumber', 'minimal satu sumber harus didefinisikan');
    return { error: error, peringatan: peringatan };
  }
  _kunciAsing('mapping', mapping, KUNCI_MAPPING, warn);
  var kunci = Object.keys(mapping.sumber);
  for (var i = 0; i < kunci.length; i++) _validasiSumber(kunci[i], mapping.sumber[kunci[i]], err, warn);
  _validasiRujukan(mapping, err);
  if (mapping.master !== undefined && mapping.master !== null) _validasiMaster(mapping.master, err, warn);
  if (mapping.opname !== undefined && mapping.opname !== null) _validasiOpname(mapping.opname, err, warn);
  return { error: error, peringatan: peringatan };
}

// ---- src/lib/sumber.js ----
/**
 * Pembangun pipeline agregasi yang mengubah dokumen transaksi dari koleksi mana pun
 * jadi satu bentuk "baris mutasi" yang seragam:
 *
 *   { sumber, koleksi, kategori, docId, tanggal, companyCode, kodeBarang, qty, arah,
 *     noTransaksi, idAsal, idDokumen, noAju, noReg, noUrut, jenisDokumen, satuan,
 *     gudang, createdAt,
 *     // kolom diagnosa:
 *     tanggalTipe, kodeBarangAsli, kodeBarangTipe, qtyAsli, qtyTipe, arahAsli,
 *     headerJumlah, linkTipe }
 *
 * Fungsi di file ini murni (hanya menyusun pipeline), tidak menjalankan query.
 */


var PREFIX_HEADER = '__h';
var TIPE_QTY_KONVERSI = ['double', 'int', 'long', 'decimal', 'string'];

function _pathFisik(sumber, logis) {
  var lok = lokasiField(sumber, logis);
  if (!lok) return null;
  return lok.lokasi === 'header' ? PREFIX_HEADER + '.' + lok.path : lok.path;
}

function _ekspresi(sumber, logis) {
  var p = _pathFisik(sumber, logis);
  return p === null ? null : '$' + p;
}

function _atauNull(expr) {
  return expr === null ? { $literal: null } : { $ifNull: [expr, null] };
}

function _gabungFilter(a, b) {
  var adaA = a && Object.keys(a).length > 0;
  var adaB = b && Object.keys(b).length > 0;
  if (adaA && adaB) return { $and: [a, b] };
  if (adaA) return a;
  if (adaB) return b;
  return null;
}

/**
 * Terjemahkan filter logis ke path fisik, dipisah per lokasi (detail / header).
 *   filterLogis: { companyCode, kodeBarang (teks | array), tanggal: { gte, lt } }
 */
function _filterPerLokasi(kunci, sumber, filterLogis) {
  var hasil = { detail: {}, header: {} };
  function taruh(logis, kondisi) {
    var lok = lokasiField(sumber, logis);
    if (!lok) throw new Error('Filter "' + logis + '" tidak bisa dipakai: field belum dipetakan di sumber "' + kunci + '"');
    if (lok.lokasi === 'header') hasil.header[PREFIX_HEADER + '.' + lok.path] = kondisi;
    else hasil.detail[lok.path] = kondisi;
  }
  if (filterLogis.companyCode !== undefined && filterLogis.companyCode !== null) {
    taruh('companyCode', filterLogis.companyCode);
  }
  if (filterLogis.kodeBarang !== undefined && filterLogis.kodeBarang !== null) {
    taruh('kodeBarang', Array.isArray(filterLogis.kodeBarang) ? { $in: filterLogis.kodeBarang } : filterLogis.kodeBarang);
  }
  if (filterLogis.tanggal) {
    var k = {};
    if (filterLogis.tanggal.gte) k.$gte = filterLogis.tanggal.gte;
    if (filterLogis.tanggal.lt) k.$lt = filterLogis.tanggal.lt;
    if (Object.keys(k).length) taruh('tanggal', k);
  }
  return hasil;
}

function _ekspresiArah(sumber) {
  var a = sumber.arah;
  if (a === 'IN' || a === 'OUT') return { expr: { $literal: a }, asli: { $literal: null } };
  if (a === 'TANDA_QTY') {
    return {
      expr: { $cond: [{ $eq: ['$__qty', null] }, 'TIDAK_DIKENAL', { $cond: [{ $lt: ['$__qty', 0] }, 'OUT', 'IN'] }] },
      asli: { $literal: null },
    };
  }
  var mentah = a.dari === 'header' ? '$' + PREFIX_HEADER + '.' + a.field : '$' + a.field;
  var normal = { $toUpper: { $trim: { input: { $convert: { input: mentah, to: 'string', onError: '', onNull: '' } } } } };
  var cabang = [];
  var kunci = Object.keys(a.nilai);
  for (var i = 0; i < kunci.length; i++) {
    cabang.push({ case: { $eq: [normal, normalKunciArah(kunci[i])] }, then: a.nilai[kunci[i]] });
  }
  return { expr: { $switch: { branches: cabang, default: 'TIDAK_DIKENAL' } }, asli: { $ifNull: [mentah, null] } };
}

/**
 * Susun pipeline untuk satu sumber.
 *   kunci  : nama sumber di MAPPING (mis. 'incoming')
 *   sumber : definisi sumber (MAPPING.sumber[kunci])
 *   opsi   : {
 *     filter : { companyCode, kodeBarang, tanggal: { gte, lt } }  (opsional)
 *     sampel : n  -> ambil n dokumen detail terbaru (urut _id menurun) SEBELUM lookup header
 *     matchAwal : filter MongoDB mentah yang ditambahkan di $match pertama (mis. { _id: { $in: [...] } })
 *     tanpaFilterSumber : true = abaikan sumber.filter (dipakai saat menelusuri dokumen
 *                         yang dirujuk ledger, supaya dokumen yang "seharusnya tersaring" tetap terlihat)
 *   }
 *
 * Catatan performa: filter yang field-nya ada di header diterapkan SETELAH $lookup.
 * Untuk koleksi besar, sertakan filter yang ada di detail (mis. kodeBarang).
 */
function bangunPipelineSumber(kunci, sumber, opsi) {
  opsi = opsi || {};
  var filter = _filterPerLokasi(kunci, sumber, opsi.filter || {});
  var pipeline = [];

  var filterTetap = opsi.tanpaFilterSumber ? null : sumber.filter;
  var matchDetail = _gabungFilter(_gabungFilter(opsi.matchAwal, filterTetap), filter.detail);
  if (matchDetail) pipeline.push({ $match: matchDetail });
  if (opsi.sampel) {
    pipeline.push({ $sort: { _id: -1 } });
    pipeline.push({ $limit: opsi.sampel });
  }

  var h = sumber.header;
  if (h) {
    var localField = h.localField;
    if (h.konversi) {
      pipeline.push({
        $addFields: {
          __link: {
            $convert: {
              input: '$' + h.localField,
              to: h.konversi === 'toObjectId' ? 'objectId' : 'string',
              onError: null,
              onNull: null,
            },
          },
        },
      });
      localField = '__link';
    }
    pipeline.push({ $lookup: { from: h.koleksi, localField: localField, foreignField: h.foreignField || '_id', as: PREFIX_HEADER } });
    pipeline.push({
      $addFields: {
        __hJumlah: { $size: '$' + PREFIX_HEADER },
        __h: { $arrayElemAt: ['$' + PREFIX_HEADER, 0] },
      },
    });
    var filterHeaderTetap = {};
    if (h.filter) {
      var kf = Object.keys(h.filter);
      for (var i = 0; i < kf.length; i++) filterHeaderTetap[PREFIX_HEADER + '.' + kf[i]] = h.filter[kf[i]];
    }
    var matchHeader = _gabungFilter(filterHeaderTetap, filter.header);
    if (matchHeader) pipeline.push({ $match: matchHeader });
  }

  var qtyMentah = _ekspresi(sumber, 'qty');
  pipeline.push({
    $addFields: {
      __qty: {
        $cond: [
          { $in: [{ $type: qtyMentah }, TIPE_QTY_KONVERSI] },
          { $convert: { input: qtyMentah, to: 'double', onError: null, onNull: null } },
          null,
        ],
      },
    },
  });

  var tanggal = _ekspresi(sumber, 'tanggal');
  var kode = _ekspresi(sumber, 'kodeBarang');
  var arah = _ekspresiArah(sumber);
  var proyeksi = {
    _id: 0,
    sumber: { $literal: kunci },
    koleksi: { $literal: sumber.koleksi },
    kategori: { $literal: sumber.kategori === undefined ? null : sumber.kategori },
    docId: '$_id',
    tanggal: _atauNull(tanggal),
    companyCode: _atauNull(_ekspresi(sumber, 'companyCode')),
    kodeBarang: { $cond: [{ $eq: [{ $type: kode }, 'string'] }, { $trim: { input: kode } }, { $ifNull: [kode, null] }] },
    qty: sumber.arah === 'TANDA_QTY' ? { $abs: '$__qty' } : '$__qty',
    arah: arah.expr,
    tanggalTipe: { $type: tanggal },
    kodeBarangAsli: _atauNull(kode),
    kodeBarangTipe: { $type: kode },
    qtyAsli: _atauNull(qtyMentah),
    qtyTipe: { $type: qtyMentah },
    arahAsli: arah.asli,
    headerJumlah: h ? '$__hJumlah' : { $literal: null },
    linkTipe: h ? { $type: '$' + h.localField } : { $literal: null },
  };
  for (var j = 0; j < FIELD_OPSIONAL.length; j++) {
    proyeksi[FIELD_OPSIONAL[j]] = _atauNull(_ekspresi(sumber, FIELD_OPSIONAL[j]));
  }
  pipeline.push({ $project: proyeksi });
  return pipeline;
}

/** Lokasi filter logis yang jatuh di header (dipakai untuk catatan di laporan) */
function filterDiHeader(sumber, filterLogis) {
  var hasil = [];
  var daftar = ['companyCode', 'kodeBarang', 'tanggal'];
  for (var i = 0; i < daftar.length; i++) {
    var f = daftar[i];
    if (filterLogis[f] === undefined || filterLogis[f] === null) continue;
    var lok = lokasiField(sumber, f);
    if (lok && lok.lokasi === 'header') hasil.push(f);
  }
  return hasil;
}

// ---- src/lib/mutasi.js ----
/**
 * Perhitungan mutasi: gabungan sumber yang dihitung, rekap saldo per kode barang,
 * deteksi saldo minus (saldo berjalan), dan pembandingan baris ledger dengan dokumen sumbernya.
 *
 * Fungsi di file ini murni (menyusun pipeline / mengolah hasil), tidak menjalankan query.
 *
 * Model saldo:  saldo akhir = saldo awal + masuk - keluar
 *   saldo awal = akumulasi semua transaksi SEBELUM periode
 *   masuk/keluar = transaksi DI DALAM periode (batas atas eksklusif, zona waktu MAPPING)
 */


var EPS_MUTASI = 1e-6;
var URUTAN_TANDA = [
  'MINUS', 'AWAL_MINUS', 'PERNAH_MINUS', 'TIDAK_DI_MASTER', 'SATUAN_CAMPUR', 'SEBELUM_CUTOFF',
  'MINUS_SESAAT', 'ARAH_TIDAK_DIKENAL', 'QTY_KOSONG', 'TANPA_TANGGAL',
];

function bulatkan(n) {
  return Math.round(n * 1e6) / 1e6;
}

/** Bulatkan ke d desimal (setengah ke atas), tahan galat floating point: 1,235 -> 1,24 */
function bulatkanDesimal(n, d) {
  var f = Math.pow(10, d);
  return Math.round(parseFloat((n * f).toFixed(8))) / f;
}

/** Nama sumber yang ikut dihitung (hitungMutasi bukan false), sesuai urutan di MAPPING */
function sumberDihitung(mapping) {
  var hasil = [];
  var kunci = Object.keys(mapping.sumber || {});
  for (var i = 0; i < kunci.length; i++) {
    if (mapping.sumber[kunci[i]] && mapping.sumber[kunci[i]].hitungMutasi !== false) hasil.push(kunci[i]);
  }
  return hasil;
}

/**
 * Pipeline gabungan semua sumber yang dihitung ($unionWith), dijalankan di koleksi sumber pertama.
 * Field tambahan per baris: asal (fallback nama sumber), qtyBertanda (+IN / -OUT), urutArah (IN dulu).
 */
function pipelineGabungan(mapping, kunciSumber, filterLogis) {
  if (!kunciSumber.length) throw new Error('Tidak ada sumber yang dihitung (semua hitungMutasi: false)');
  var pertama = kunciSumber[0];
  var pipeline = bangunPipelineSumber(pertama, mapping.sumber[pertama], { filter: filterLogis });
  for (var i = 1; i < kunciSumber.length; i++) {
    var k = kunciSumber[i];
    pipeline.push({
      $unionWith: { coll: mapping.sumber[k].koleksi, pipeline: bangunPipelineSumber(k, mapping.sumber[k], { filter: filterLogis }) },
    });
  }
  pipeline.push({
    $addFields: {
      asal: { $ifNull: ['$asal', '$sumber'] },
      qtyBertanda: {
        $switch: {
          branches: [
            { case: { $eq: ['$arah', 'IN'] }, then: { $ifNull: ['$qty', 0] } },
            { case: { $eq: ['$arah', 'OUT'] }, then: { $multiply: [{ $ifNull: ['$qty', 0] }, -1] } },
          ],
          default: 0,
        },
      },
      urutArah: { $cond: [{ $eq: ['$arah', 'IN'] }, 0, 1] },
    },
  });
  return { koleksi: mapping.sumber[pertama].koleksi, pipeline: pipeline };
}

/** Tahap agregasi rekap: jumlah qty per kode x satuan x asal x arah x bucket waktu */
function tahapRekap(rentang, cutoff) {
  var kondisiCutoff = cutoff ? { $and: [{ $eq: ['$tanggalTipe', 'date'] }, { $lt: ['$tanggal', cutoff] }] } : false;
  return [
    {
      $addFields: {
        __bucket: {
          $cond: [
            { $eq: ['$tanggalTipe', 'date'] },
            {
              $switch: {
                branches: [
                  { case: { $lt: ['$tanggal', rentang.gte] }, then: 'AWAL' },
                  { case: { $lt: ['$tanggal', rentang.lt] }, then: 'PERIODE' },
                ],
                default: 'SESUDAH',
              },
            },
            'TANPA_TANGGAL',
          ],
        },
      },
    },
    {
      $group: {
        _id: { kode: '$kodeBarang', satuan: '$satuan', asal: '$asal', arah: '$arah', bucket: '$__bucket' },
        qty: { $sum: { $ifNull: ['$qty', 0] } },
        dok: { $sum: 1 },
        qtyKosong: { $sum: { $cond: [{ $eq: ['$qty', null] }, 1, 0] } },
        sebelumCutoff: { $sum: { $cond: [kondisiCutoff, 1, 0] } },
      },
    },
  ];
}

/**
 * Tahap agregasi saldo berjalan per kode ($setWindowFields + $shift, MongoDB 5.0+).
 *   opsi.per = 'hari'      -> saldo dinilai per AKHIR HARI (zona waktu opsi.tz). Minus sesaat di tengah hari
 *                             karena urutan jam input tidak dihitung.
 *   opsi.per = 'transaksi' -> saldo dinilai setelah setiap transaksi.
 * Hasil hanya untuk kode yang saldonya minus di periode:
 *   transisi = true  -> titik pertama di periode saat saldo berubah dari >= 0 menjadi minus
 *   transisi = false -> saldo sudah minus sejak sebelum periode (tidak ada transisi di periode)
 *   + saldoSebelum, saldo, saldoMin, jumlahMinus (jumlah hari/transaksi dengan saldo minus di periode)
 *   per hari      : hari, masukHari, keluarHari, dokHari
 *   per transaksi : asal, arah, qty, docId, idAsal
 */
function tahapMinus(rentang, opsi) {
  opsi = opsi || {};
  var harian = opsi.per === 'hari';
  var tahap = [{ $match: { tanggalTipe: 'date', tanggal: { $lt: rentang.lt } } }];
  var urut;
  var urutAkhir;
  if (harian) {
    tahap.push({
      $group: {
        _id: {
          kode: '$kodeBarang',
          hari: { $dateToString: { format: '%Y-%m-%d', date: '$tanggal', timezone: opsi.tz || TZ_DEFAULT } },
        },
        qtyBertanda: { $sum: '$qtyBertanda' },
        masuk: { $sum: { $cond: [{ $eq: ['$arah', 'IN'] }, { $ifNull: ['$qty', 0] }, 0] } },
        keluar: { $sum: { $cond: [{ $eq: ['$arah', 'OUT'] }, { $ifNull: ['$qty', 0] }, 0] } },
        dok: { $sum: 1 },
        tanggal: { $max: '$tanggal' },
      },
    });
    tahap.push({
      $project: { _id: 0, kodeBarang: '$_id.kode', hari: '$_id.hari', qtyBertanda: 1, masuk: 1, keluar: 1, dok: 1, tanggal: 1 },
    });
    urut = { hari: 1 };
    urutAkhir = { kodeBarang: 1, __transisi: -1, hari: 1 };
  } else {
    urut = { tanggal: 1, urutArah: 1, docId: 1 };
    urutAkhir = { kodeBarang: 1, __transisi: -1, tanggal: 1, urutArah: 1, docId: 1 };
  }
  return tahap.concat([
    {
      $setWindowFields: {
        partitionBy: '$kodeBarang',
        sortBy: urut,
        output: { __saldo: { $sum: '$qtyBertanda', window: { documents: ['unbounded', 'current'] } } },
      },
    },
    {
      $setWindowFields: {
        partitionBy: '$kodeBarang',
        sortBy: urut,
        output: { __sebelum: { $shift: { output: '$__saldo', by: -1, default: 0 } } },
      },
    },
    { $match: { tanggal: { $gte: rentang.gte }, __saldo: { $lt: -EPS_MUTASI } } },
    { $addFields: { __transisi: { $gte: ['$__sebelum', -EPS_MUTASI] } } },
    { $sort: urutAkhir },
    {
      $group: {
        _id: '$kodeBarang',
        transisi: { $first: '$__transisi' },
        tanggal: { $first: '$tanggal' },
        saldo: { $first: '$__saldo' },
        saldoSebelum: { $first: '$__sebelum' },
        hari: { $first: '$hari' },
        masukHari: { $first: '$masuk' },
        keluarHari: { $first: '$keluar' },
        dokHari: { $first: '$dok' },
        asal: { $first: '$asal' },
        arah: { $first: '$arah' },
        qty: { $first: '$qty' },
        docId: { $first: '$docId' },
        idAsal: { $first: '$idAsal' },
        saldoMin: { $min: '$__saldo' },
        jumlahMinus: { $sum: 1 },
      },
    },
  ]);
}

function _teksKunci(v) {
  return v === null || v === undefined ? '(kosong)' : String(v);
}

/** Olah hasil tahapRekap jadi satu objek per kode barang */
function pivotRekap(baris) {
  var perKode = {};
  var urutan = [];
  for (var i = 0; i < baris.length; i++) {
    var b = baris[i];
    var id = b._id || {};
    var kode = id.kode === undefined ? null : id.kode;
    var kunci = _teksKunci(kode);
    var r = perKode[kunci];
    if (!r) {
      r = {
        kodeBarang: kode, satuan: {}, awal: 0, masuk: 0, keluar: 0, perAsal: {},
        dokAwal: 0, dokPeriode: 0, dokSesudah: 0, tanpaTanggal: 0, arahTidakDikenal: 0, qtyKosong: 0, sebelumCutoff: 0,
      };
      perKode[kunci] = r;
      urutan.push(kunci);
    }
    var satuan = _teksKunci(id.satuan);
    r.satuan[satuan] = (r.satuan[satuan] || 0) + b.dok;
    r.qtyKosong += b.qtyKosong || 0;
    r.sebelumCutoff += b.sebelumCutoff || 0;
    if (id.bucket === 'TANPA_TANGGAL') {
      r.tanpaTanggal += b.dok;
      continue;
    }
    if (id.arah !== 'IN' && id.arah !== 'OUT') {
      r.arahTidakDikenal += b.dok;
      continue;
    }
    var masuk = id.arah === 'IN';
    if (id.bucket === 'AWAL') {
      r.awal += masuk ? b.qty : -b.qty;
      r.dokAwal += b.dok;
    } else if (id.bucket === 'PERIODE') {
      r.dokPeriode += b.dok;
      if (masuk) r.masuk += b.qty;
      else r.keluar += b.qty;
      var asal = _teksKunci(id.asal);
      var pa = r.perAsal[asal] || (r.perAsal[asal] = { masuk: 0, keluar: 0, dok: 0 });
      if (masuk) pa.masuk += b.qty;
      else pa.keluar += b.qty;
      pa.dok += b.dok;
    } else {
      r.dokSesudah += b.dok;
    }
  }
  var hasil = [];
  urutan.sort();
  for (var u = 0; u < urutan.length; u++) {
    var x = perKode[urutan[u]];
    x.awal = bulatkan(x.awal);
    x.masuk = bulatkan(x.masuk);
    x.keluar = bulatkan(x.keluar);
    x.akhir = bulatkan(x.awal + x.masuk - x.keluar);
    for (var a in x.perAsal) {
      x.perAsal[a].masuk = bulatkan(x.perAsal[a].masuk);
      x.perAsal[a].keluar = bulatkan(x.perAsal[a].keluar);
    }
    hasil.push(x);
  }
  return hasil;
}

/**
 * Tanda masalah untuk satu baris rekap.
 *   info: { master: objek|null, cekMaster: bool, minus: hasil tahapMinus|null }
 */
function tandaiRekap(r, info) {
  var tanda = [];
  if (r.akhir < -EPS_MUTASI) tanda.push('MINUS');
  if (r.awal < -EPS_MUTASI) tanda.push('AWAL_MINUS');
  if (info.minus && r.akhir >= -EPS_MUTASI) tanda.push('PERNAH_MINUS');
  if (info.minusSesaat && !info.minus && r.akhir >= -EPS_MUTASI) tanda.push('MINUS_SESAAT');
  if (info.cekMaster && !info.master) tanda.push('TIDAK_DI_MASTER');
  if (Object.keys(r.satuan).length > 1) tanda.push('SATUAN_CAMPUR');
  if (r.sebelumCutoff > 0) tanda.push('SEBELUM_CUTOFF');
  if (r.arahTidakDikenal > 0) tanda.push('ARAH_TIDAK_DIKENAL');
  if (r.qtyKosong > 0) tanda.push('QTY_KOSONG');
  if (r.tanpaTanggal > 0) tanda.push('TANPA_TANGGAL');
  return tanda;
}

/** Bobot urut: kode dengan tanda paling berat tampil duluan */
function bobotTanda(tanda) {
  var bobot = URUTAN_TANDA.length + 1;
  for (var i = 0; i < tanda.length; i++) {
    var p = URUTAN_TANDA.indexOf(tanda[i]);
    if (p >= 0 && p < bobot) bobot = p;
  }
  return bobot;
}

/** Nilai id (ObjectId / string hex) -> string hex huruf kecil, atau null */
function kunciIdHex(v) {
  if (v && typeof v === 'object' && (v._bsontype === 'ObjectId' || v._bsontype === 'ObjectID')) return v.toHexString().toLowerCase();
  if (typeof v === 'string' && POLA_HEX24.test(v)) return v.toLowerCase();
  return null;
}

/**
 * Bandingkan baris ledger dengan dokumen sumber yang dirujuk (keduanya sudah dinormalisasi).
 * Hasil: daftar kode temuan ([] = cocok).
 */
function bandingkanDenganSumber(baris, sumberDoc, tz) {
  if (!sumberDoc) return ['SUMBER_HILANG'];
  var hasil = [];
  if (sumberDoc.dihapus === true) hasil.push('SUMBER_DIHAPUS');
  if (typeof baris.qty === 'number' && typeof sumberDoc.qty === 'number') {
    if (Math.abs(baris.qty - sumberDoc.qty) > EPS_MUTASI) hasil.push('QTY_BEDA');
  } else if (baris.qty !== sumberDoc.qty) {
    hasil.push('QTY_BEDA');
  }
  if (baris.kodeBarang !== sumberDoc.kodeBarang) hasil.push('KODE_BEDA');
  if ((sumberDoc.arah === 'IN' || sumberDoc.arah === 'OUT') && sumberDoc.arah !== baris.arah) hasil.push('ARAH_BEDA');
  var tglA = baris.tanggal instanceof Date ? formatLokal(baris.tanggal, tz, false) : null;
  var tglB = sumberDoc.tanggal instanceof Date ? formatLokal(sumberDoc.tanggal, tz, false) : null;
  if (tglA !== tglB) hasil.push('TANGGAL_BEDA');
  if (baris.satuan !== null && baris.satuan !== undefined && sumberDoc.satuan !== null && sumberDoc.satuan !== undefined &&
      String(baris.satuan).trim() !== String(sumberDoc.satuan).trim()) {
    hasil.push('SATUAN_BEDA');
  }
  return hasil;
}

/** Nama sumber tujuan rujukan untuk satu baris (memakai MAPPING.sumber[baris.sumber].rujukan) */
function tujuanRujukan(mapping, baris) {
  var s = mapping.sumber[baris.sumber];
  if (!s || !s.rujukan) return null;
  return sumberRujukan(s, baris.asal, baris.arah);
}

// ---- src/lib/runner.js ----
/**
 * Lapisan shell (mongosh): eksekusi query read-only, override untuk test,
 * header laporan, dan output teks/JSON.
 *
 * Aturan:
 *   - Hanya find / aggregate / count. Tidak ada operasi tulis.
 *   - Panggilan shell API tidak diletakkan di dalam callback (map/forEach/sort)
 *     supaya aman dengan async rewriter mongosh.
 */

var PENANDA_JSON_AWAL = '__TRACE_JSON_BEGIN__';
var PENANDA_JSON_AKHIR = '__TRACE_JSON_END__';
var BATAS_SAMPEL = 5000;

function daftarNamaKoleksi(d) {
  return d.getCollectionNames();
}

function jalankanAgregasi(d, koleksi, pipeline) {
  return d.getCollection(koleksi).aggregate(pipeline, { allowDiskUse: true }).toArray();
}

function ambilSampel(d, koleksi, n, mode) {
  if (mode === 'acak') return d.getCollection(koleksi).aggregate([{ $sample: { size: n } }]).toArray();
  return d.getCollection(koleksi).find({}).sort({ _id: -1 }).limit(n).toArray();
}

function estimasiJumlahDokumen(d, koleksi) {
  try {
    return d.getCollection(koleksi).estimatedDocumentCount();
  } catch (e) {
    return null;
  }
}

function angkaSampel(nilai, nama) {
  var n = Number(nilai);
  if (!isFinite(n) || n < 1 || Math.floor(n) !== n) {
    throw new Error('CONFIG.' + nama + ' harus bilangan bulat >= 1 (sekarang: ' + JSON.stringify(nilai) + ')');
  }
  if (n > BATAS_SAMPEL) throw new Error('CONFIG.' + nama + ' maksimal ' + BATAS_SAMPEL + ' (sekarang: ' + n + ')');
  return n;
}

/**
 * Master barang (MAPPING.master) untuk companyCode tertentu.
 * Hasil: { ada: bool, peta: { kodeTrim: { nama, kategori, satuan, ganda } } }
 */
function ambilMaster(d, mapping, companyCode, kodeList, kategori) {
  var master = mapping.master;
  if (!master) {
    if (kategori) throw new Error('CONFIG.KATEGORI butuh MAPPING.master');
    return { ada: false, peta: {} };
  }
  var f = master.field;
  var match = {};
  if (companyCode && f.companyCode) match[f.companyCode] = companyCode;
  if (kodeList) match[f.kodeBarang] = { $in: kodeList };
  if (kategori) {
    if (!f.kategori) throw new Error('CONFIG.KATEGORI butuh MAPPING.master.field.kategori');
    match[f.kategori] = kategori;
  }
  var proyeksi = { _id: 0, kode: '$' + f.kodeBarang };
  proyeksi.nama = f.nama ? { $ifNull: ['$' + f.nama, null] } : { $literal: null };
  proyeksi.kategori = f.kategori ? { $ifNull: ['$' + f.kategori, null] } : { $literal: null };
  proyeksi.satuan = f.satuan ? { $ifNull: ['$' + f.satuan, null] } : { $literal: null };
  var baris = jalankanAgregasi(d, master.koleksi, [{ $match: match }, { $project: proyeksi }]);
  var peta = {};
  for (var i = 0; i < baris.length; i++) {
    if (typeof baris[i].kode !== 'string') continue;
    var k = baris[i].kode.trim();
    if (peta[k]) peta[k].ganda++;
    else peta[k] = { nama: baris[i].nama, kategori: baris[i].kategori, satuan: baris[i].satuan, ganda: 0 };
  }
  return { ada: true, peta: peta };
}

function _versiServer(d) {
  try {
    return d.version();
  } catch (e) {
    return null;
  }
}

function _overrideTrace() {
  if (typeof __TRACE_OVERRIDE__ !== 'undefined' && __TRACE_OVERRIDE__) return __TRACE_OVERRIDE__;
  return {};
}

function _headerTeks(meta, ctx) {
  var garis = new Array(79).join('=');
  var status = meta.statusMapping;
  var ketMapping = status === 'TERVERIFIKASI'
    ? 'TERVERIFIKASI'
    : (status || 'tanpa status') + ' (nama koleksi/field belum diverifikasi dengan data asli)';
  var baris = [
    garis,
    ' ERP Trace Mutation | ' + meta.tool + ' | v' + meta.versi,
    ' ' + ctx.info.judul,
    ' DB      : ' + meta.db + (meta.server ? ' (MongoDB ' + meta.server + ')' : ''),
    ' Waktu   : ' + formatLokal(ctx.waktu, ctx.tz) + ' ' + labelZona(ctx.tz),
  ];
  if (ctx.info.pakaiMapping !== false) baris.push(' Mapping : ' + ketMapping);
  baris.push(garis);
  return baris;
}

/**
 * Titik masuk semua tool.
 *   info       : { nama, judul, versi }
 *   configFile : CONFIG dari file
 *   mappingFile: MAPPING dari file
 *   fnJalankan : function (config, mapping, ctx) -> hasil
 *   fnRender   : function (hasil, ctx, config) -> array baris teks
 */
function jalankanTool(info, configFile, mappingFile, fnJalankan, fnRender) {
  var ov = _overrideTrace();
  var config = Object.assign({}, configFile, ov.CONFIG || {});
  var mapping = ov.MAPPING || mappingFile;
  var format = String(config.FORMAT || 'teks').toLowerCase();
  if (format !== 'teks' && format !== 'json') throw new Error('CONFIG.FORMAT harus "teks" atau "json"');

  var dbAktif = config.DB ? db.getSiblingDB(config.DB) : db;
  var tz = (mapping && mapping.timezone) || TZ_DEFAULT;
  var ctx = { db: dbAktif, tz: tz, info: info, waktu: new Date() };

  var hasil;
  try {
    hasil = fnJalankan(config, mapping, ctx);
  } catch (e) {
    print('GAGAL [' + info.nama + ']: ' + (e && e.message ? e.message : String(e)));
    throw e;
  }

  var paket = {
    meta: {
      tool: info.nama,
      versi: info.versi,
      db: dbAktif.getName(),
      server: _versiServer(dbAktif),
      waktu: ctx.waktu,
      timezone: tz,
      statusMapping: info.pakaiMapping !== false && mapping && mapping.meta ? mapping.meta.status || null : null,
    },
    hasil: hasil,
  };

  if (format === 'json') {
    print(PENANDA_JSON_AWAL);
    print(JSON.stringify(keJSONAman(paket), null, 2));
    print(PENANDA_JSON_AKHIR);
  } else {
    print(_headerTeks(paket.meta, ctx).concat(fnRender(hasil, ctx, config)).join('\n'));
  }
  return paket;
}

// ======================= TOOL (src/tools/01-mutasi.js) ==========================
var MUTASI_MAKS_KODE_KARTU = 20;

function _mutasiDaftarKode(nilai) {
  if (nilai === null || nilai === undefined || nilai === '') return null;
  var daftar = Array.isArray(nilai) ? nilai : [nilai];
  var hasil = [];
  for (var i = 0; i < daftar.length; i++) {
    if (typeof daftar[i] !== 'string' || daftar[i].trim() === '') {
      throw new Error('CONFIG.KODE_BARANG harus teks atau array teks (elemen ke-' + i + ' tidak valid)');
    }
    if (hasil.indexOf(daftar[i]) < 0) hasil.push(daftar[i]);
  }
  return hasil.length ? hasil : null;
}

/** Semua kode di master (untuk saran kode mirip), diambil sekali per jalankan */
function _mutasiKodeMaster(ctx, mapping, config) {
  if (!ctx.__kodeMaster) ctx.__kodeMaster = Object.keys(ambilMaster(ctx.db, mapping, config.COMPANY_CODE, null, null).peta);
  return ctx.__kodeMaster;
}

function _mutasiFilter(config, kode) {
  return { companyCode: config.COMPANY_CODE || null, kodeBarang: kode };
}

// ------------------------------------------------------------------ rekap

function _mutasiRekap(config, mapping, ctx, rentang, cutoff, kunci, kodeList, master) {
  var hasil = {
    mode: 'rekap',
    periode: rentang.label,
    companyCode: config.COMPANY_CODE || null,
    kategori: config.KATEGORI || null,
    cutoff: config.TANGGAL_CUTOFF || null,
    sumberDihitung: kunci,
    ringkasan: { jumlahKode: 0, tanda: {}, perAsal: {} },
    kode: [],
    catatan: [],
  };
  if (config.KATEGORI && kodeList && !kodeList.length) {
    hasil.catatan.push('Tidak ada kode barang di master dengan kategori ' + JSON.stringify(config.KATEGORI) + '.');
    return hasil;
  }
  if (config.KATEGORI) hasil.catatan.push('Filter kategori memakai master barang; kode yang tidak ada di master tidak ikut.');

  var g = pipelineGabungan(mapping, kunci, _mutasiFilter(config, kodeList));
  var rekap = pivotRekap(jalankanAgregasi(ctx.db, g.koleksi, g.pipeline.concat(tahapRekap(rentang, cutoff))));
  var per = config.MINUS_PER;
  var barisMinus = jalankanAgregasi(ctx.db, g.koleksi, g.pipeline.concat(tahapMinus(rentang, { per: per, tz: ctx.tz })));
  var minus = {};
  var i;
  for (i = 0; i < barisMinus.length; i++) minus[String(barisMinus[i]._id)] = barisMinus[i];
  var minusTransaksi = {};
  if (per === 'hari') {
    var barisTransaksi = jalankanAgregasi(ctx.db, g.koleksi, g.pipeline.concat(tahapMinus(rentang, { per: 'transaksi' })));
    for (i = 0; i < barisTransaksi.length; i++) minusTransaksi[String(barisTransaksi[i]._id)] = true;
  }
  hasil.minusPer = per;

  for (i = 0; i < rekap.length; i++) {
    var r = rekap[i];
    var kunciKode = r.kodeBarang === null ? '(kosong)' : String(r.kodeBarang);
    var m = master.ada && typeof r.kodeBarang === 'string' ? master.peta[r.kodeBarang] || null : null;
    var infoMinus = minus[kunciKode] || null;
    r.master = m ? { nama: m.nama, kategori: m.kategori, satuan: m.satuan } : null;
    r.minus = infoMinus
      ? {
        per: per,
        transisi: infoMinus.transisi,
        tanggal: infoMinus.tanggal,
        hari: infoMinus.hari,
        saldo: bulatkan(infoMinus.saldo),
        saldoSebelum: bulatkan(infoMinus.saldoSebelum),
        masukHari: infoMinus.masukHari === null || infoMinus.masukHari === undefined ? null : bulatkan(infoMinus.masukHari),
        keluarHari: infoMinus.keluarHari === null || infoMinus.keluarHari === undefined ? null : bulatkan(infoMinus.keluarHari),
        dokHari: infoMinus.dokHari,
        asal: infoMinus.asal,
        arah: infoMinus.arah,
        qty: infoMinus.qty,
        docId: infoMinus.docId,
        idAsal: infoMinus.idAsal,
        saldoMin: bulatkan(infoMinus.saldoMin),
        jumlahMinus: infoMinus.jumlahMinus,
      }
      : null;
    r.tanda = tandaiRekap(r, { master: m, cekMaster: master.ada, minus: infoMinus, minusSesaat: !!minusTransaksi[kunciKode] });
    if (master.ada && !m && typeof r.kodeBarang === 'string') {
      r.kodeMirip = kandidatNama(r.kodeBarang, _mutasiKodeMaster(ctx, mapping, config), 3);
    }
    for (var t = 0; t < r.tanda.length; t++) hasil.ringkasan.tanda[r.tanda[t]] = (hasil.ringkasan.tanda[r.tanda[t]] || 0) + 1;
    for (var a in r.perAsal) {
      var pa = hasil.ringkasan.perAsal[a] || (hasil.ringkasan.perAsal[a] = { masuk: 0, keluar: 0, dok: 0 });
      pa.masuk = bulatkan(pa.masuk + r.perAsal[a].masuk);
      pa.keluar = bulatkan(pa.keluar + r.perAsal[a].keluar);
      pa.dok += r.perAsal[a].dok;
    }
  }
  rekap.sort(function (x, y) {
    var bx = bobotTanda(x.tanda);
    var by = bobotTanda(y.tanda);
    if (bx !== by) return bx - by;
    var kx = String(x.kodeBarang);
    var ky = String(y.kodeBarang);
    return kx < ky ? -1 : kx > ky ? 1 : 0;
  });
  hasil.ringkasan.jumlahKode = rekap.length;
  hasil.kode = rekap;
  return hasil;
}

// ------------------------------------------------------------------ kartu

function _mutasiCekSumber(ctx, mapping, baris) {
  var perTujuan = {};
  var i;
  for (i = 0; i < baris.length; i++) {
    var b = baris[i];
    var tujuan = tujuanRujukan(mapping, b);
    if (!tujuan) {
      b.cek = mapping.sumber[b.sumber] && mapping.sumber[b.sumber].rujukan ? ['RUJUKAN_TIDAK_ADA'] : null;
      continue;
    }
    var k = kunciIdHex(b.idAsal);
    if (!k) {
      b.cek = [b.idAsal === null || b.idAsal === undefined || b.idAsal === '' ? 'ID_ASAL_KOSONG' : 'ID_ASAL_TIDAK_VALID'];
      continue;
    }
    b.__tujuan = tujuan;
    b.__kunci = k;
    if (!perTujuan[tujuan]) perTujuan[tujuan] = {};
    perTujuan[tujuan][k] = true;
  }
  var dokumen = {};
  var daftarTujuan = Object.keys(perTujuan);
  for (i = 0; i < daftarTujuan.length; i++) {
    var nama = daftarTujuan[i];
    var kunciId = Object.keys(perTujuan[nama]);
    var nilai = [];
    for (var j = 0; j < kunciId.length; j++) {
      nilai.push(ObjectId(kunciId[j]));
      nilai.push(kunciId[j]);
    }
    var pipeline = bangunPipelineSumber(nama, mapping.sumber[nama], { matchAwal: { _id: { $in: nilai } }, tanpaFilterSumber: true });
    var hasilSumber = jalankanAgregasi(ctx.db, mapping.sumber[nama].koleksi, pipeline);
    var peta = {};
    for (var h = 0; h < hasilSumber.length; h++) peta[kunciIdHex(hasilSumber[h].docId)] = hasilSumber[h];
    dokumen[nama] = peta;
  }
  for (i = 0; i < baris.length; i++) {
    var x = baris[i];
    if (!x.__tujuan) continue;
    var src = dokumen[x.__tujuan][x.__kunci] || null;
    x.cek = bandingkanDenganSumber(x, src, ctx.tz);
    x.dokSumber = src
      ? {
        sumber: x.__tujuan,
        noTransaksi: src.noTransaksi,
        jenisDokumen: src.jenisDokumen,
        noAju: src.noAju,
        qty: src.qty,
        satuan: src.satuan,
        tanggal: src.tanggal,
        kodeBarang: src.kodeBarang,
        dihapus: src.dihapus,
      }
      : { sumber: x.__tujuan };
    delete x.__tujuan;
    delete x.__kunci;
  }
}

function _mutasiKartuSatuKode(config, mapping, ctx, rentang, cutoff, kunci, kode, master) {
  var g = pipelineGabungan(mapping, kunci, _mutasiFilter(config, kode));
  var rekap = pivotRekap(jalankanAgregasi(ctx.db, g.koleksi, g.pipeline.concat(tahapRekap(rentang, cutoff))));
  var r = rekap.length ? rekap[0] : null;
  var maks = Number(config.KARTU_MAKS_BARIS);
  var baris = jalankanAgregasi(ctx.db, g.koleksi, g.pipeline.concat([
    { $match: { tanggalTipe: 'date', tanggal: { $gte: rentang.gte, $lt: rentang.lt } } },
    { $sort: { tanggal: 1, urutArah: 1, docId: 1 } },
    { $limit: maks + 1 },
  ]));
  var terpotong = baris.length > maks;
  if (terpotong) baris = baris.slice(0, maks);

  var saldoAwal = r ? r.awal : 0;
  var harian = config.MINUS_PER === 'hari';
  var saldo = saldoAwal;
  var minusPertama = null;
  var adaMinus = false;
  var adaMinusTransaksi = false;
  var akhirHariSebelum = saldoAwal;
  var hari = null;
  var ringkasHari = null;
  function tutupHari() {
    if (!ringkasHari) return;
    var akhir = ringkasHari.barisTerakhir.saldo;
    ringkasHari.barisTerakhir.akhirHari = true;
    if (akhir < -EPS_MUTASI) {
      adaMinus = true;
      if (!minusPertama && akhirHariSebelum >= -EPS_MUTASI) {
        minusPertama = {
          per: 'hari', hari: ringkasHari.hari, tanggal: ringkasHari.barisTerakhir.tanggal, saldoSebelum: akhirHariSebelum,
          saldo: akhir, masukHari: bulatkan(ringkasHari.masuk), keluarHari: bulatkan(ringkasHari.keluar), dokHari: ringkasHari.dok,
          baris: ringkasHari.barisTerakhir,
        };
      }
    }
    akhirHariSebelum = akhir;
  }
  for (var i = 0; i < baris.length; i++) {
    var b0 = baris[i];
    var sebelum = saldo;
    saldo = bulatkan(saldo + b0.qtyBertanda);
    b0.saldo = saldo;
    b0.saldoSebelum = sebelum;
    if (saldo < -EPS_MUTASI) adaMinusTransaksi = true;
    if (harian) {
      var hariIni = formatLokal(b0.tanggal, ctx.tz, false);
      if (hariIni !== hari) {
        tutupHari();
        hari = hariIni;
        ringkasHari = { hari: hariIni, masuk: 0, keluar: 0, dok: 0, barisTerakhir: null };
      }
      if (b0.arah === 'IN') ringkasHari.masuk += b0.qty || 0;
      else if (b0.arah === 'OUT') ringkasHari.keluar += b0.qty || 0;
      ringkasHari.dok++;
      ringkasHari.barisTerakhir = b0;
    } else if (saldo < -EPS_MUTASI) {
      adaMinus = true;
      if (!minusPertama && sebelum >= -EPS_MUTASI) {
        minusPertama = { per: 'transaksi', tanggal: b0.tanggal, asal: b0.asal, arah: b0.arah, qty: b0.qty, saldoSebelum: sebelum, saldo: saldo, baris: b0 };
      }
    }
  }
  if (harian) tutupHari();
  if (config.CEK_SUMBER) _mutasiCekSumber(ctx, mapping, baris);

  var ringkasCek = {};
  var keluaran = [];
  for (var j = 0; j < baris.length; j++) {
    var b = baris[j];
    if (b.cek) {
      if (!b.cek.length) ringkasCek.OK = (ringkasCek.OK || 0) + 1;
      for (var c = 0; c < b.cek.length; c++) ringkasCek[b.cek[c]] = (ringkasCek[b.cek[c]] || 0) + 1;
    }
    keluaran.push({
      tanggal: b.tanggal,
      sumber: b.sumber,
      asal: b.asal,
      proses: b.proses,
      arah: b.arah,
      masuk: b.arah === 'IN' ? b.qty : null,
      keluar: b.arah === 'OUT' ? b.qty : null,
      saldo: b.saldo,
      akhirHari: b.akhirHari === true,
      satuan: b.satuan,
      docId: b.docId,
      idAsal: b.idAsal,
      dokSumber: b.dokSumber || null,
      cek: b.cek === undefined ? null : b.cek,
    });
  }
  var m = master.ada ? master.peta[kode.trim()] || null : null;
  var tanda = r ? tandaiRekap(r, { master: m, cekMaster: master.ada, minus: adaMinus ? true : null, minusSesaat: harian && adaMinusTransaksi }) : [];
  if (!r && master.ada && !m) tanda.push('TIDAK_DI_MASTER');
  return {
    kodeBarang: kode,
    master: m ? { nama: m.nama, kategori: m.kategori, satuan: m.satuan } : null,
    saldoAwal: r ? r.awal : 0,
    masuk: r ? r.masuk : 0,
    keluar: r ? r.keluar : 0,
    saldoAkhir: r ? r.akhir : 0,
    saldoAkhirBerjalan: terpotong ? null : saldo,
    satuan: r ? r.satuan : {},
    jumlahBaris: keluaran.length,
    terpotong: terpotong,
    minusPer: config.MINUS_PER,
    minusPertama: minusPertama
      ? {
        per: minusPertama.per, hari: minusPertama.hari || null, tanggal: minusPertama.tanggal,
        asal: minusPertama.asal || null, arah: minusPertama.arah || null, qty: minusPertama.qty === undefined ? null : minusPertama.qty,
        masukHari: minusPertama.masukHari === undefined ? null : minusPertama.masukHari,
        keluarHari: minusPertama.keluarHari === undefined ? null : minusPertama.keluarHari,
        dokHari: minusPertama.dokHari === undefined ? null : minusPertama.dokHari,
        saldoSebelum: minusPertama.saldoSebelum, saldo: minusPertama.saldo, docId: minusPertama.baris.docId,
        dokSumber: minusPertama.baris.dokSumber || null,
      }
      : null,
    minusSejakAwal: saldoAwal < -EPS_MUTASI,
    kodeMirip: master.ada && !m ? kandidatNama(kode.trim(), _mutasiKodeMaster(ctx, mapping, config), 3) : [],
    tanda: tanda,
    ringkasCek: ringkasCek,
    baris: keluaran,
  };
}

function _mutasiKartu(config, mapping, ctx, rentang, cutoff, kunci, kodeList, master) {
  if (!kodeList) throw new Error('MODE "kartu" butuh CONFIG.KODE_BARANG');
  if (kodeList.length > MUTASI_MAKS_KODE_KARTU) throw new Error('MODE "kartu" maksimal ' + MUTASI_MAKS_KODE_KARTU + ' kode sekaligus');
  var maks = Number(config.KARTU_MAKS_BARIS);
  if (!isFinite(maks) || maks < 1) throw new Error('CONFIG.KARTU_MAKS_BARIS harus >= 1');
  var kartu = [];
  for (var i = 0; i < kodeList.length; i++) {
    kartu.push(_mutasiKartuSatuKode(config, mapping, ctx, rentang, cutoff, kunci, kodeList[i], master));
  }
  return {
    mode: 'kartu',
    periode: rentang.label,
    periodeDari: rentang.dari,
    companyCode: config.COMPANY_CODE || null,
    cutoff: config.TANGGAL_CUTOFF || null,
    sumberDihitung: kunci,
    cekSumber: !!config.CEK_SUMBER,
    kartu: kartu,
  };
}

// --------------------------------------------------------------- jalankan

function jalankan(config, mapping, ctx) {
  var mode = String(config.MODE || '').toLowerCase();
  if (mode !== 'rekap' && mode !== 'kartu') throw new Error('CONFIG.MODE harus "rekap" atau "kartu"');
  if (!config.PERIODE) throw new Error('CONFIG.PERIODE wajib diisi');
  config.MINUS_PER = config.MINUS_PER || 'hari';
  if (config.MINUS_PER !== 'hari' && config.MINUS_PER !== 'transaksi') throw new Error('CONFIG.MINUS_PER harus "hari" atau "transaksi"');
  var validasi = validasiMapping(mapping);
  if (validasi.error.length) {
    var e = validasi.error[0];
    throw new Error('MAPPING tidak valid: ' + e.path + ': ' + e.pesan +
      (validasi.error.length > 1 ? ' (+' + (validasi.error.length - 1) + ' error lain, cek dengan 00-cek-mapping)' : ''));
  }
  var rentang = rentangPeriode(config.PERIODE, ctx.tz);
  var cutoff = config.TANGGAL_CUTOFF ? awalHariLokal(String(config.TANGGAL_CUTOFF), ctx.tz) : null;
  var kunci = sumberDihitung(mapping);
  var kodeList = _mutasiDaftarKode(config.KODE_BARANG);
  if (mode === 'rekap' && config.KATEGORI) {
    var masterKategori = ambilMaster(ctx.db, mapping, config.COMPANY_CODE, kodeList, config.KATEGORI);
    kodeList = Object.keys(masterKategori.peta).sort();
  }
  var master = ambilMaster(ctx.db, mapping, config.COMPANY_CODE, kodeList, null);
  if (mode === 'kartu') return _mutasiKartu(config, mapping, ctx, rentang, cutoff, kunci, kodeList, master);
  return _mutasiRekap(config, mapping, ctx, rentang, cutoff, kunci, kodeList, master);
}

// ----------------------------------------------------------------- render

function _mutasiAngka(n) {
  return n === null || n === undefined ? '' : fmtAngka(n, 'auto');
}

function _mutasiSatuan(satuan) {
  var k = Object.keys(satuan || {}).sort();
  return k.length ? k.join('+') : '';
}

function _mutasiTeksMinus(m, tz) {
  if (!m) return '';
  if (m.per === 'hari') {
    return 'hari ' + m.hari + ' (masuk ' + _mutasiAngka(m.masukHari) + ', keluar ' + _mutasiAngka(m.keluarHari) + ', ' +
      m.dokHari + ' transaksi) | saldo akhir hari ' + _mutasiAngka(m.saldoSebelum) + ' -> ' + _mutasiAngka(m.saldo);
  }
  return formatLokal(m.tanggal, tz).slice(0, 16) + ' | ' + m.asal + ' ' + m.arah + ' ' + _mutasiAngka(m.qty) +
    ' | saldo ' + _mutasiAngka(m.saldoSebelum) + ' -> ' + _mutasiAngka(m.saldo);
}

function _mutasiRenderRekap(h, ctx, config) {
  var baris = [];
  baris.push('Periode : ' + h.periode + ' | companyCode ' + (h.companyCode ? JSON.stringify(h.companyCode) : '(semua)') +
    (h.kategori ? ' | kategori ' + JSON.stringify(h.kategori) : ''));
  baris.push('Dihitung dari sumber: ' + h.sumberDihitung.join(', ') + (h.cutoff ? ' | cut-off ' + h.cutoff : '') +
    ' | minus dinilai per ' + (h.minusPer === 'hari' ? 'akhir hari' : 'transaksi'));
  if (h.ringkasan.tanda.MINUS_SESAAT) {
    baris.push('MINUS_SESAAT = saldo sempat minus di tengah hari karena urutan jam input, tetapi saldo akhir harinya tidak minus.');
  }
  for (var c = 0; c < h.catatan.length; c++) baris.push('Catatan: ' + h.catatan[c]);
  var tanda = [];
  var urutTanda = Object.keys(h.ringkasan.tanda).sort(function (x, y) { return bobotTanda([x]) - bobotTanda([y]) || (x < y ? -1 : 1); });
  for (var t = 0; t < urutTanda.length; t++) tanda.push(urutTanda[t] + ' ' + h.ringkasan.tanda[urutTanda[t]]);
  baris.push('Ringkasan: ' + fmtAngka(h.ringkasan.jumlahKode) + ' kode bergerak' + (tanda.length ? ' | ' + tanda.join(' | ') : ' | tidak ada tanda masalah'));
  var asal = [];
  var daftarAsal = Object.keys(h.ringkasan.perAsal).sort();
  for (var q = 0; q < daftarAsal.length; q++) {
    var a = daftarAsal[q];
    var pa = h.ringkasan.perAsal[a];
    asal.push({ asal: a, masuk: _mutasiAngka(pa.masuk), keluar: _mutasiAngka(pa.keluar), dok: fmtAngka(pa.dok) });
  }
  if (asal.length) {
    baris.push('');
    baris.push('Mutasi periode per asal:');
    var tabelAsal = formatTabel([
      { judul: 'ASAL', kunci: 'asal' },
      { judul: 'MASUK', kunci: 'masuk', kanan: true },
      { judul: 'KELUAR', kunci: 'keluar', kanan: true },
      { judul: 'DOK', kunci: 'dok', kanan: true },
    ], asal);
    for (var x = 0; x < tabelAsal.length; x++) baris.push('  ' + tabelAsal[x]);
  }

  var tampil = [];
  for (var i = 0; i < h.kode.length; i++) {
    if (config.HANYA_BERMASALAH && !h.kode[i].tanda.length) continue;
    tampil.push(h.kode[i]);
  }
  var maks = Number(config.TAMPIL_MAKS) > 0 ? Number(config.TAMPIL_MAKS) : 200;
  var dipotong = tampil.length > maks;
  tampil = tampil.slice(0, maks);
  baris.push('');
  if (!tampil.length) {
    baris.push(config.HANYA_BERMASALAH ? 'Tidak ada kode bermasalah.' : 'Tidak ada mutasi.');
    return baris;
  }
  var data = [];
  for (var j = 0; j < tampil.length; j++) {
    var r = tampil[j];
    data.push({
      kode: r.kodeBarang === null ? '(kosong)' : r.kodeBarang,
      nama: r.master && r.master.nama ? r.master.nama : '',
      kat: r.master && r.master.kategori ? r.master.kategori : '',
      sat: _mutasiSatuan(r.satuan),
      awal: _mutasiAngka(r.awal),
      masuk: _mutasiAngka(r.masuk),
      keluar: _mutasiAngka(r.keluar),
      akhir: _mutasiAngka(r.akhir),
      tanda: r.tanda.join(','),
    });
  }
  baris = baris.concat(formatTabel([
    { judul: 'KODE', kunci: 'kode', maks: 30 },
    { judul: 'NAMA', kunci: 'nama', maks: 28 },
    { judul: 'KATEGORI', kunci: 'kat', maks: 20 },
    { judul: 'SAT', kunci: 'sat', maks: 12 },
    { judul: 'SALDO AWAL', kunci: 'awal', kanan: true },
    { judul: 'MASUK', kunci: 'masuk', kanan: true },
    { judul: 'KELUAR', kunci: 'keluar', kanan: true },
    { judul: 'SALDO AKHIR', kunci: 'akhir', kanan: true },
    { judul: 'TANDA', kunci: 'tanda' },
  ], data));
  if (dipotong) baris.push('... ditampilkan ' + maks + ' kode. Pakai FORMAT: "json" untuk daftar lengkap.');

  var adaMinus = [];
  var mirip = [];
  for (var k = 0; k < tampil.length; k++) {
    if (tampil[k].minus) adaMinus.push(tampil[k]);
    if (tampil[k].kodeMirip && tampil[k].kodeMirip.length) mirip.push(tampil[k]);
  }
  if (adaMinus.length) {
    baris.push('');
    baris.push(h.minusPer === 'hari'
      ? 'Penyebab saldo minus di periode ini (hari pertama saldo AKHIR HARI berubah dari >= 0 menjadi minus):'
      : 'Penyebab saldo minus di periode ini (transaksi yang mengubah saldo dari >= 0 menjadi minus):');
    for (var z = 0; z < adaMinus.length; z++) {
      var mi = adaMinus[z].minus;
      var penjelasan = mi.transisi
        ? _mutasiTeksMinus(mi, ctx.tz)
        : 'sudah minus sejak sebelum periode (saldo awal ' + _mutasiAngka(adaMinus[z].awal) + ')';
      baris.push('  ' + adaMinus[z].kodeBarang + ' : ' + penjelasan + ' | terendah ' + _mutasiAngka(mi.saldoMin) +
        ' (' + mi.jumlahMinus + (mi.per === 'hari' ? ' hari' : ' baris') + ' minus)');
    }
    baris.push('Telusuri per transaksi dengan MODE: "kartu" dan KODE_BARANG berisi kode di atas.');
  }
  if (mirip.length) {
    baris.push('');
    baris.push('Kode yang tidak ada di master, dengan kode mirip di master (kemungkinan salah ketik):');
    for (var y = 0; y < mirip.length; y++) baris.push('  ' + mirip[y].kodeBarang + ' -> ' + mirip[y].kodeMirip.join(', '));
  }
  return baris;
}

function _mutasiRenderKartu(h, ctx) {
  var baris = [];
  baris.push('Periode : ' + h.periode + ' | companyCode ' + (h.companyCode ? JSON.stringify(h.companyCode) : '(semua)') +
    ' | sumber: ' + h.sumberDihitung.join(', ') + (h.cekSumber ? ' | cek sumber: aktif' : ''));
  for (var i = 0; i < h.kartu.length; i++) {
    var k = h.kartu[i];
    baris.push('');
    var judul = k.kodeBarang + (k.master ? ' | ' + (k.master.nama || '-') + ' | ' + (k.master.kategori || '-') +
      ' | satuan master ' + (k.master.satuan || '-')
      : ' | (tidak ada di master' + (k.kodeMirip.length ? '; mirip: ' + k.kodeMirip.join(', ') : '') + ')');
    baris.push(new Array(4).join('=') + ' ' + judul + ' ' + new Array(Math.max(3, 74 - judul.length)).join('='));
    baris.push('Saldo awal (sebelum ' + h.periodeDari + '): ' + (_mutasiAngka(k.saldoAwal) + ' ' + _mutasiSatuan(k.satuan)).trim() +
      (k.tanda.length ? ' | tanda: ' + k.tanda.join(', ') : ''));
    if (!k.baris.length) {
      baris.push('(tidak ada transaksi di periode ini)');
    } else {
      var data = [];
      for (var j = 0; j < k.baris.length; j++) {
        var b = k.baris[j];
        var ds = b.dokSumber || {};
        data.push({
          tgl: formatLokal(b.tanggal, ctx.tz).slice(0, 16),
          asal: b.asal,
          proses: b.proses || '',
          no: ds.noTransaksi || '',
          dok: ds.jenisDokumen || '',
          masuk: _mutasiAngka(b.masuk),
          keluar: _mutasiAngka(b.keluar),
          saldo: _mutasiAngka(b.saldo),
          sat: b.satuan || '',
          cek: b.cek === null ? '' : b.cek.length ? b.cek.join(',') : 'OK',
        });
      }
      baris = baris.concat(formatTabel([
        { judul: 'TANGGAL (' + labelZona(ctx.tz) + ')', kunci: 'tgl' },
        { judul: 'ASAL', kunci: 'asal' },
        { judul: 'PROSES', kunci: 'proses', maks: 12 },
        { judul: 'NO. TRANSAKSI', kunci: 'no', maks: 32 },
        { judul: 'DOK', kunci: 'dok', maks: 8 },
        { judul: 'MASUK', kunci: 'masuk', kanan: true },
        { judul: 'KELUAR', kunci: 'keluar', kanan: true },
        { judul: 'SALDO', kunci: 'saldo', kanan: true },
        { judul: 'SAT', kunci: 'sat' },
        { judul: 'CEK', kunci: 'cek' },
      ], data));
    }
    if (k.terpotong) baris.push('... dipotong di ' + k.jumlahBaris + ' baris (KARTU_MAKS_BARIS); saldo akhir di bawah dari rekap.');
    baris.push('Saldo akhir: ' + _mutasiAngka(k.saldoAkhir) + ' (masuk ' + _mutasiAngka(k.masuk) + ', keluar ' + _mutasiAngka(k.keluar) +
      ', ' + k.jumlahBaris + ' transaksi)');
    if (k.minusSejakAwal) baris.push('Saldo sudah minus sejak sebelum periode (saldo awal ' + _mutasiAngka(k.saldoAwal) + ').');
    if (k.minusPertama) {
      var ds2 = k.minusPertama.dokSumber || {};
      baris.push((k.minusPertama.per === 'hari' ? 'Saldo akhir hari berubah jadi minus: ' : 'Saldo berubah jadi minus: ') +
        _mutasiTeksMinus(k.minusPertama, ctx.tz) +
        (ds2.noTransaksi ? (k.minusPertama.per === 'hari' ? ' | transaksi terakhir hari itu ' : ' | ') + ds2.noTransaksi : ''));
    }
    if (k.tanda.indexOf('MINUS_SESAAT') >= 0) {
      baris.push('Catatan: saldo sempat minus di tengah hari (urutan jam input), tetapi saldo akhir harinya tidak minus.');
    }
    var cek = [];
    for (var c in k.ringkasCek) cek.push(c + ' ' + k.ringkasCek[c]);
    if (cek.length) baris.push('Cek sumber: ' + cek.join(' | '));
  }
  return baris;
}

function render(hasil, ctx, config) {
  return hasil.mode === 'kartu' ? _mutasiRenderKartu(hasil, ctx) : _mutasiRenderRekap(hasil, ctx, config);
}

return jalankanTool({"nama":"01-mutasi","judul":"Mutasi stok per kode barang: rekap periode (saldo awal, masuk, keluar, saldo akhir) dan kartu stok","versi":"0.6.0","pakaiMapping":true}, CONFIG, MAPPING, jalankan, render);
})();
