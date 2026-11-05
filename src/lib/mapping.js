/**
 * Definisi field logis + validasi struktur MAPPING (config/mapping.js).
 */

// #region node-only
var offsetMenit = require('./tanggal').offsetMenit;
// #endregion

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
var KUNCI_MAPPING = ['meta', 'timezone', 'sumber', 'master'];
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
  return { error: error, peringatan: peringatan };
}

// #region node-only
module.exports = {
  FIELD_WAJIB: FIELD_WAJIB,
  FIELD_OPSIONAL: FIELD_OPSIONAL,
  normalKunciArah: normalKunciArah,
  lokasiField: lokasiField,
  daftarKoleksiMapping: daftarKoleksiMapping,
  ringkasArah: ringkasArah,
  sumberRujukan: sumberRujukan,
  validasiMapping: validasiMapping,
};
// #endregion
