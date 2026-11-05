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

// #region node-only
module.exports = {
  padKanan: padKanan,
  padKiri: padKiri,
  potong: potong,
  fmtAngka: fmtAngka,
  fmtPersen: fmtPersen,
  formatTabel: formatTabel,
};
// #endregion
