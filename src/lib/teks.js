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

// #region node-only
module.exports = {
  polaString: polaString,
  punyaSpasiTepi: punyaSpasiTepi,
  jarakLevenshtein: jarakLevenshtein,
  kandidatNama: kandidatNama,
  teratas: teratas,
};
// #endregion
