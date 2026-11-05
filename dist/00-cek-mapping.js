/*
 * ============================================================================
 *  ERP Trace Mutation | 00-cek-mapping | v0.2.0
 *  Cek kecocokan MAPPING dengan data asli: koleksi, field, tipe, arah, dan relasi header
 * ----------------------------------------------------------------------------
 *  FILE HASIL BUILD. Yang boleh diedit hanya blok KONFIGURASI di bawah.
 *  Kode sumber: src/tools/00-cek-mapping.js | mapping: config/mapping.js
 *  Setelah mengubah sumber/mapping jalankan `npm run build`.
 *
 *  Cara pakai:
 *    mongosh "<connection-string>/<database>" --file dist/00-cek-mapping.js
 *    atau di dalam mongosh : load("dist/00-cek-mapping.js")
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
  // Sumber yang dicek (nama di MAPPING.sumber). [] = semua sumber.
  // Contoh: ['incoming', 'delivery']
  SUMBER: [],

  // Jumlah dokumen detail TERBARU per sumber yang dicek (maks 5000)
  SAMPEL: 500,

  // Opsional: batasi ke periode tertentu (zona waktu dari MAPPING.timezone)
  // '2026-10' | '2026' | '2026-10-15' | { dari: '2026-10-01', sampai: '2026-10-15' }
  PERIODE: null,

  // Opsional: batasi ke satu companyCode
  COMPANY_CODE: null,

  // Database: null = database aktif di koneksi
  DB: null,

  // 'teks' | 'json'
  FORMAT: 'teks',
};

// =================== MAPPING (dari config/mapping.js) ========================
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
var MAPPING = {
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
];
var ARAH_STATIS = ['IN', 'OUT', 'TANDA_QTY'];
var KONVERSI_LINK = ['toObjectId', 'toString'];
var KUNCI_SUMBER = ['label', 'koleksi', 'arah', 'kategori', 'hitungMutasi', 'filter', 'field', 'header'];
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
  return hasil;
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
  var kunci = Object.keys(mapping.sumber);
  for (var i = 0; i < kunci.length; i++) _validasiSumber(kunci[i], mapping.sumber[kunci[i]], err, warn);
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
 *   }
 *
 * Catatan performa: filter yang field-nya ada di header diterapkan SETELAH $lookup.
 * Untuk koleksi besar, sertakan filter yang ada di detail (mis. kodeBarang).
 */
function bangunPipelineSumber(kunci, sumber, opsi) {
  opsi = opsi || {};
  var filter = _filterPerLokasi(kunci, sumber, opsi.filter || {});
  var pipeline = [];

  var matchDetail = _gabungFilter(sumber.filter, filter.detail);
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

// ======================= TOOL (src/tools/00-cek-mapping.js) ==========================
var CEK_MAKS_CONTOH = 5;

function _kosong(v) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

function _hitungNilai(baris, kunci, saring) {
  var hasil = {};
  for (var i = 0; i < baris.length; i++) {
    if (saring && !saring(baris[i])) continue;
    var v = baris[i][kunci];
    var k = v === null || v === undefined ? '(kosong)' : String(v);
    hasil[k] = (hasil[k] || 0) + 1;
  }
  return hasil;
}

function _teksHitungan(hitungan, total, kutip) {
  var daftar = teratas(hitungan, 10);
  var bagian = [];
  for (var i = 0; i < daftar.length; i++) {
    var label = kutip ? JSON.stringify(daftar[i].nilai) : daftar[i].nilai;
    bagian.push(label + ' ' + (total ? fmtPersen(daftar[i].jumlah, total) : daftar[i].jumlah));
  }
  var sisa = Object.keys(hitungan).length - daftar.length;
  return bagian.join(', ') + (sisa > 0 ? ' +' + sisa + ' lainnya' : '');
}

function _tipeForeign(d, header) {
  var ff = header.foreignField || '_id';
  var baris = jalankanAgregasi(d, header.koleksi, [{ $limit: 20 }, { $project: { _id: 0, t: { $type: '$' + ff } } }]);
  var hitung = {};
  for (var i = 0; i < baris.length; i++) hitung[baris[i].t] = (hitung[baris[i].t] || 0) + 1;
  var atas = teratas(hitung, 1);
  return atas.length ? atas[0].nilai : null;
}

function _saranKonversi(tipeLink, tipeForeign, konversiSekarang) {
  if (tipeLink === 'string' && tipeForeign === 'objectId' && konversiSekarang !== 'toObjectId') {
    return 'localField bertipe string sedangkan ' + 'foreignField bertipe objectId: set header.konversi: "toObjectId"';
  }
  if (tipeLink === 'objectId' && tipeForeign === 'string' && konversiSekarang !== 'toString') {
    return 'localField bertipe objectId sedangkan foreignField bertipe string: set header.konversi: "toString"';
  }
  return 'cek nama header.localField / header.foreignField (tipe localField: ' + tipeLink + ', tipe foreignField: ' + tipeForeign + ')';
}

function _analisisSumber(kunci, s, baris, ctx, tambah) {
  var total = baris.length;
  var stat = { sampel: total };
  if (!total) {
    tambah('PERINGATAN', 'SAMPEL_KOSONG', 'Tidak ada dokumen yang cocok (koleksi kosong, atau filter PERIODE/COMPANY_CODE/filter sumber terlalu sempit).');
    return stat;
  }
  var i;

  // --- relasi header ---
  var punyaHeader = !!s.header;
  var barisTerhubung = baris;
  if (punyaHeader) {
    var yatim = 0;
    var ganda = 0;
    barisTerhubung = [];
    for (i = 0; i < total; i++) {
      if (baris[i].headerJumlah === 0) yatim++;
      else barisTerhubung.push(baris[i]);
      if (baris[i].headerJumlah > 1) ganda++;
    }
    stat.headerYatim = yatim;
    stat.headerGanda = ganda;
    if (yatim === total) {
      var tipeLink = teratas(_hitungNilai(baris, 'linkTipe'), 1)[0].nilai;
      var tipeForeign = _tipeForeign(ctx.db, s.header);
      tambah('ERROR', 'HEADER_TIDAK_TERHUBUNG',
        'Tidak ada detail yang menemukan header-nya di ' + s.header.koleksi + '. Saran: ' +
        _saranKonversi(tipeLink, tipeForeign, s.header.konversi), total);
    } else if (yatim > 0) {
      tambah('PERINGATAN', 'DETAIL_YATIM', yatim + ' detail tidak punya header (header terhapus atau link salah).', yatim);
    }
    if (ganda > 0) {
      tambah('PERINGATAN', 'HEADER_GANDA', ganda + ' detail cocok ke lebih dari satu header (foreignField tidak unik).', ganda);
    }
  }

  // --- keterisian field (pakai nilai mentah: qty/kode yang formatnya salah tetap dihitung "terisi") ---
  var kolomMentah = { qty: 'qtyAsli', kodeBarang: 'kodeBarangAsli' };
  var semuaField = FIELD_WAJIB.concat(FIELD_OPSIONAL);
  stat.keterisian = {};
  for (var f = 0; f < semuaField.length; f++) {
    var nama = semuaField[f];
    var lok = lokasiField(s, nama);
    if (!lok) continue;
    var acuan = lok.lokasi === 'header' ? barisTerhubung : baris;
    if (!acuan.length) continue;
    var kolom = kolomMentah[nama] || nama;
    var isi = 0;
    for (i = 0; i < acuan.length; i++) if (!_kosong(acuan[i][kolom])) isi++;
    stat.keterisian[nama] = { isi: isi, dari: acuan.length, path: (lok.lokasi === 'header' ? 'header.' : '') + lok.path };
    var wajib = FIELD_WAJIB.indexOf(nama) >= 0;
    var label = '"' + nama + '" (' + stat.keterisian[nama].path + ')';
    if (isi === 0) {
      if (wajib) tambah('ERROR', 'FIELD_WAJIB_KOSONG_SEMUA', 'Field wajib ' + label + ' kosong di semua sampel; kemungkinan nama field salah.', acuan.length);
      else tambah('PERINGATAN', 'FIELD_OPSIONAL_KOSONG', 'Field opsional ' + label + ' selalu kosong; cek nama field.', acuan.length);
    } else if (wajib && isi < acuan.length) {
      tambah('PERINGATAN', 'FIELD_WAJIB_KOSONG_SEBAGIAN', 'Field wajib ' + label + ' kosong di ' + (acuan.length - isi) + ' dokumen (' + fmtPersen(acuan.length - isi, acuan.length) + ').', acuan.length - isi);
    }
  }

  // --- tanggal ---
  var tipeTanggal = _hitungNilai(barisTerhubung, 'tanggalTipe');
  stat.tipeTanggal = tipeTanggal;
  var bukanDate = 0;
  var jumlahDate = tipeTanggal.date || 0;
  for (var tt in tipeTanggal) {
    if (tt !== 'date' && tt !== 'null' && tt !== 'missing') bukanDate += tipeTanggal[tt];
  }
  if (bukanDate > 0) {
    var levelTgl = jumlahDate === 0 ? 'ERROR' : 'PERINGATAN';
    tambah(levelTgl, 'TANGGAL_BUKAN_DATE', 'Field tanggal bukan tipe Date di ' + bukanDate + ' dokumen (tipe: ' +
      _teksHitungan(tipeTanggal, 0, false) + '). Filter periode tidak akan menemukan dokumen ini.', bukanDate);
  }
  if (jumlahDate > 0) {
    var jam = {};
    var min = null;
    var max = null;
    var depan = 0;
    var batasDepan = new Date(ctx.waktu.getTime() + 24 * 3600 * 1000);
    for (i = 0; i < barisTerhubung.length; i++) {
      var t = barisTerhubung[i].tanggal;
      if (!(t instanceof Date) || isNaN(t.getTime())) continue;
      var j = jamLokal(t, ctx.tz);
      jam[j] = (jam[j] || 0) + 1;
      if (min === null || t < min) min = t;
      if (max === null || t > max) max = t;
      if (t > batasDepan) depan++;
    }
    stat.jamLokal = jam;
    stat.tanggalMin = min;
    stat.tanggalMax = max;
    tambah('INFO', 'INFO_TANGGAL', 'Rentang tanggal sampel ' + formatLokal(min, ctx.tz, false) + ' s/d ' + formatLokal(max, ctx.tz, false) +
      ' | jam ' + labelZona(ctx.tz) + ': ' + _teksHitungan(jam, jumlahDate, false));
    if (depan > 0) tambah('PERINGATAN', 'TANGGAL_MASA_DEPAN', depan + ' dokumen bertanggal lebih dari 1 hari ke depan.', depan);
  }

  // --- qty ---
  var tipeQty = _hitungNilai(baris, 'qtyTipe');
  stat.tipeQty = tipeQty;
  tambah('INFO', 'INFO_QTY_TIPE', 'Tipe qty: ' + _teksHitungan(tipeQty, total, false));
  var qtyString = 0;
  var qtyStringGagal = 0;
  var polaGagal = {};
  var qtyAneh = 0;
  var negatif = 0;
  var nol = 0;
  for (i = 0; i < total; i++) {
    var b = baris[i];
    if (b.qtyTipe === 'string') {
      qtyString++;
      if (b.qty === null) {
        qtyStringGagal++;
        var pola = polaString(b.qtyAsli);
        polaGagal[pola] = (polaGagal[pola] || 0) + 1;
      }
    } else if (b.qty === null && b.qtyTipe !== 'null' && b.qtyTipe !== 'missing') {
      qtyAneh++;
    }
    if (b.qty !== null && b.qty !== undefined) {
      if (s.arah !== 'TANDA_QTY' && b.qty < 0) negatif++;
      if (b.qty === 0) nol++;
    }
  }
  if (qtyString > 0) {
    tambah('PERINGATAN', 'QTY_STRING', 'qty bertipe string di ' + qtyString + ' dokumen (' + (qtyString - qtyStringGagal) +
      ' bisa dikonversi ke angka, ' + qtyStringGagal + ' tidak' +
      (qtyStringGagal ? ': pola ' + _teksHitungan(polaGagal, 0, true) : '') + ').', qtyString);
  }
  if (qtyAneh > 0) tambah('PERINGATAN', 'QTY_BUKAN_ANGKA', 'qty bukan angka/teks di ' + qtyAneh + ' dokumen.', qtyAneh);
  if (negatif > 0) tambah('PERINGATAN', 'QTY_NEGATIF', 'qty negatif di ' + negatif + ' dokumen (arah sumber ini ' + ringkasArah(s.arah) + ').', negatif);
  if (nol > 0) tambah('INFO', 'INFO_QTY_NOL', 'qty = 0 di ' + nol + ' dokumen.', nol);

  // --- kodeBarang ---
  var kodeSpasi = 0;
  var kodeBukanString = 0;
  for (i = 0; i < total; i++) {
    if (baris[i].kodeBarangTipe === 'string') {
      if (baris[i].kodeBarangAsli !== baris[i].kodeBarang) kodeSpasi++;
    } else if (baris[i].kodeBarangTipe !== 'null' && baris[i].kodeBarangTipe !== 'missing') {
      kodeBukanString++;
    }
  }
  if (kodeSpasi > 0) tambah('PERINGATAN', 'KODE_SPASI', 'kodeBarang punya spasi di awal/akhir di ' + kodeSpasi + ' dokumen (bisa bikin barang yang sama terhitung terpisah).', kodeSpasi);
  if (kodeBukanString > 0) tambah('PERINGATAN', 'KODE_BUKAN_STRING', 'kodeBarang bukan string di ' + kodeBukanString + ' dokumen (tipe: ' + _teksHitungan(_hitungNilai(baris, 'kodeBarangTipe'), 0, false) + ').', kodeBukanString);

  // --- companyCode ---
  var company = _hitungNilai(barisTerhubung, 'companyCode');
  stat.companyCode = company;
  if (Object.keys(company).length) tambah('INFO', 'INFO_COMPANY', 'companyCode: ' + _teksHitungan(company, 0, true));

  // --- arah ---
  var arah = _hitungNilai(baris, 'arah');
  stat.arah = arah;
  tambah('INFO', 'INFO_ARAH', 'Arah: ' + _teksHitungan(arah, 0, false));
  if (arah.TIDAK_DIKENAL) {
    var pesanArah;
    if (s.arah === 'TANDA_QTY') {
      pesanArah = 'Arah tidak bisa ditentukan di ' + arah.TIDAK_DIKENAL + ' dokumen karena qty tidak terbaca.';
    } else {
      var asli = _hitungNilai(baris, 'arahAsli', function (x) { return x.arah === 'TIDAK_DIKENAL'; });
      var contoh = teratas(asli, CEK_MAKS_CONTOH);
      var daftarContoh = [];
      for (i = 0; i < contoh.length; i++) daftarContoh.push(JSON.stringify(contoh[i].nilai) + ' (' + contoh[i].jumlah + ')');
      stat.arahTidakDikenal = asli;
      pesanArah = 'Arah tidak dikenali di ' + arah.TIDAK_DIKENAL + ' dokumen. Nilai asli: ' + daftarContoh.join(', ') +
        '. Tambahkan ke arah.nilai bila memang valid.';
    }
    tambah('PERINGATAN', 'ARAH_TIDAK_DIKENAL', pesanArah, arah.TIDAK_DIKENAL);
  }
  return stat;
}

function _cekSumber(kunci, s, validasi, semuaKoleksi, opsi, ctx) {
  var temuan = [];
  function tambah(level, kode, pesan, jumlah) {
    var t = { level: level, kode: kode, pesan: pesan };
    if (jumlah !== undefined) t.jumlah = jumlah;
    temuan.push(t);
  }
  var awalan = 'sumber.' + kunci;
  var i;
  for (i = 0; i < validasi.error.length; i++) {
    var e = validasi.error[i];
    if (e.path === awalan || e.path.indexOf(awalan + '.') === 0) tambah('ERROR', 'VALIDASI', e.path + ': ' + e.pesan);
  }
  for (i = 0; i < validasi.peringatan.length; i++) {
    var w = validasi.peringatan[i];
    if (w.path === awalan || w.path.indexOf(awalan + '.') === 0) tambah('PERINGATAN', 'VALIDASI', w.path + ': ' + w.pesan);
  }

  var info = {
    kunci: kunci,
    label: s && s.label ? s.label : kunci,
    koleksi: s ? s.koleksi : null,
    koleksiHeader: s && s.header ? s.header.koleksi : null,
    arah: s ? ringkasArah(s.arah) : null,
    kategori: s && s.kategori !== undefined ? s.kategori : null,
    hitungMutasi: !(s && s.hitungMutasi === false),
  };

  function selesai(stat) {
    var status = 'OK';
    for (var t = 0; t < temuan.length; t++) {
      if (temuan[t].level === 'ERROR') status = 'ERROR';
      else if (temuan[t].level === 'PERINGATAN' && status === 'OK') status = 'PERINGATAN';
    }
    info.status = status;
    info.temuan = temuan;
    info.statistik = stat || null;
    return info;
  }

  for (i = 0; i < temuan.length; i++) if (temuan[i].level === 'ERROR') return selesai(null);

  if (!info.hitungMutasi) tambah('INFO', 'INFO_TIDAK_DIHITUNG', 'Sumber ini tidak ikut dihitung di saldo (hitungMutasi: false).');

  var cekKoleksi = [s.koleksi];
  if (s.header) cekKoleksi.push(s.header.koleksi);
  var hilang = false;
  for (i = 0; i < cekKoleksi.length; i++) {
    if (semuaKoleksi.indexOf(cekKoleksi[i]) < 0) {
      var kandidat = kandidatNama(cekKoleksi[i], semuaKoleksi, 5);
      tambah('ERROR', i === 0 ? 'KOLEKSI_TIDAK_ADA' : 'HEADER_KOLEKSI_TIDAK_ADA',
        'Koleksi "' + cekKoleksi[i] + '" tidak ditemukan.' + (kandidat.length ? ' Mungkin maksudnya: ' + kandidat.join(', ') : ''));
      hilang = true;
    }
  }
  if (hilang) return selesai(null);

  var filter = {};
  if (opsi.rentang) filter.tanggal = { gte: opsi.rentang.gte, lt: opsi.rentang.lt };
  if (opsi.companyCode) filter.companyCode = opsi.companyCode;
  var diHeader = filterDiHeader(s, filter);
  if (diHeader.length) {
    tambah('INFO', 'INFO_FILTER_HEADER', 'Filter ' + diHeader.join(', ') + ' ada di header, jadi diterapkan setelah mengambil ' + opsi.sampel + ' detail terbaru.');
  }
  var pipeline = bangunPipelineSumber(kunci, s, { filter: filter, sampel: opsi.sampel });
  var baris = jalankanAgregasi(ctx.db, s.koleksi, pipeline);
  return selesai(_analisisSumber(kunci, s, baris, ctx, tambah));
}

function jalankan(config, mapping, ctx) {
  var n = angkaSampel(config.SAMPEL, 'SAMPEL');
  var rentang = config.PERIODE ? rentangPeriode(config.PERIODE, ctx.tz) : null;
  var validasi = validasiMapping(mapping);

  var errorGlobal = [];
  var peringatanGlobal = [];
  var i;
  for (i = 0; i < validasi.error.length; i++) {
    if (validasi.error[i].path.indexOf('sumber.') !== 0) errorGlobal.push(validasi.error[i]);
  }
  for (i = 0; i < validasi.peringatan.length; i++) {
    if (validasi.peringatan[i].path.indexOf('sumber.') !== 0) peringatanGlobal.push(validasi.peringatan[i]);
  }

  var hasil = {
    statusMapping: mapping && mapping.meta ? mapping.meta.status || null : null,
    sampel: n,
    periode: rentang ? rentang.label : null,
    companyCode: config.COMPANY_CODE || null,
    errorGlobal: errorGlobal,
    peringatanGlobal: peringatanGlobal,
    sumber: [],
    ringkasan: { OK: 0, PERINGATAN: 0, ERROR: 0 },
  };
  if (errorGlobal.length) return hasil;

  var semuaSumber = Object.keys(mapping.sumber);
  var dipilih = config.SUMBER && config.SUMBER.length ? config.SUMBER : semuaSumber;
  for (i = 0; i < dipilih.length; i++) {
    if (semuaSumber.indexOf(dipilih[i]) < 0) {
      throw new Error('Sumber "' + dipilih[i] + '" tidak ada di MAPPING. Yang tersedia: ' + semuaSumber.join(', '));
    }
  }

  var semuaKoleksi = daftarNamaKoleksi(ctx.db);
  var opsi = { rentang: rentang, companyCode: config.COMPANY_CODE || null, sampel: n };
  for (i = 0; i < dipilih.length; i++) {
    var satu = _cekSumber(dipilih[i], mapping.sumber[dipilih[i]], validasi, semuaKoleksi, opsi, ctx);
    hasil.sumber.push(satu);
    hasil.ringkasan[satu.status]++;
  }
  return hasil;
}

function render(hasil) {
  var baris = [];
  baris.push('Sampel: ' + hasil.sampel + ' dokumen terbaru per sumber' +
    (hasil.periode ? ' | periode ' + hasil.periode : '') +
    (hasil.companyCode ? ' | companyCode ' + JSON.stringify(hasil.companyCode) : ''));
  var i;
  for (i = 0; i < hasil.errorGlobal.length; i++) baris.push('[ERROR] ' + hasil.errorGlobal[i].path + ': ' + hasil.errorGlobal[i].pesan);
  for (i = 0; i < hasil.peringatanGlobal.length; i++) baris.push('[PERINGATAN] ' + hasil.peringatanGlobal[i].path + ': ' + hasil.peringatanGlobal[i].pesan);
  if (hasil.errorGlobal.length) {
    baris.push('');
    baris.push('MAPPING tidak valid; perbaiki error di atas dulu.');
    return baris;
  }
  for (i = 0; i < hasil.sumber.length; i++) {
    var s = hasil.sumber[i];
    baris.push('');
    baris.push(padKanan('[' + s.status + ']', 13) + s.kunci + ' | ' + s.label + ' | ' + s.koleksi +
      (s.koleksiHeader ? ' + ' + s.koleksiHeader : '') + ' | arah ' + s.arah +
      (s.kategori ? ' | kategori ' + s.kategori : ''));
    if (s.statistik) baris.push('              sampel ' + s.statistik.sampel + ' dokumen');
    for (var t = 0; t < s.temuan.length; t++) {
      baris.push('              - ' + padKanan(s.temuan[t].level, 10) + ' ' + s.temuan[t].pesan);
    }
  }
  var r = hasil.ringkasan;
  baris.push('');
  baris.push('Ringkasan: ' + r.OK + ' OK | ' + r.PERINGATAN + ' PERINGATAN | ' + r.ERROR + ' ERROR');
  return baris;
}

return jalankanTool({"nama":"00-cek-mapping","judul":"Cek kecocokan MAPPING dengan data asli: koleksi, field, tipe, arah, dan relasi header","versi":"0.2.0","pakaiMapping":true}, CONFIG, MAPPING, jalankan, render);
})();
