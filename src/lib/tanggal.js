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

// #region node-only
module.exports = {
  TZ_DEFAULT: TZ_DEFAULT,
  offsetMenit: offsetMenit,
  labelZona: labelZona,
  awalHariLokal: awalHariLokal,
  geserHari: geserHari,
  rentangPeriode: rentangPeriode,
  formatLokal: formatLokal,
  jamLokal: jamLokal,
};
// #endregion
