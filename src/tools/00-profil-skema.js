/**
 * @nama 00-profil-skema
 * @judul Profil struktur koleksi: field, tipe data, keterisian, dan pola nilai (data asli disamarkan)
 */

// #region config
var CONFIG = {
  // Koleksi yang diprofil. [] = semua koleksi yang disebut di MAPPING (detail + header).
  // Contoh: ['tbl_incomingdetail', 'tbl_deliverydetail']
  KOLEKSI: [],

  // Jumlah dokumen sampel per koleksi (maks 5000)
  SAMPEL: 200,

  // 'terbaru' = urut _id menurun (ringan, pakai index _id) | 'acak' = $sample
  MODE_SAMPEL: 'terbaru',

  // Tampilkan nilai asli untuk field yang variasinya sedikit (status, jenis, kode dokumen BC, dsb.).
  // false = semua string disamarkan jadi pola.
  TAMPILKAN_ENUM: true,

  // Maksimal jumlah nilai unik supaya field dianggap "enum"
  ENUM_MAKS: 8,

  // Kedalaman maksimal field bersarang yang ditelusuri
  KEDALAMAN_MAKS: 4,

  // Database: null = database aktif di koneksi
  DB: null,

  // 'teks' | 'json'
  FORMAT: 'teks',
};
// #endregion

var PROFIL_BATAS_PATH = 300;
var PROFIL_BATAS_ELEMEN_ARRAY = 50;
var PROFIL_BATAS_POLA = 50;
var PROFIL_PANJANG_ENUM = 40;

function _entriProfil(st, path) {
  var e = st.path[path];
  if (e) return e;
  if (st.urutan.length >= PROFIL_BATAS_PATH) {
    st.terpotong = true;
    return null;
  }
  e = {
    ada: 0,
    _doc: -1,
    tipe: {},
    tipeSumber: 'klien',
    pola: {},
    polaLain: 0,
    nilai: {},
    nilaiLuber: false,
    jumlahString: 0,
    spasiTepi: 0,
    kosong: 0,
    negatif: 0,
    nol: 0,
    pecahan: 0,
    jam: {},
    jumlahTanggal: 0,
    tglMin: null,
    tglMax: null,
    arrMin: null,
    arrMax: null,
  };
  st.path[path] = e;
  st.urutan.push(path);
  return e;
}

function _catatString(e, s, config) {
  e.jumlahString++;
  if (s === '') e.kosong++;
  if (punyaSpasiTepi(s)) e.spasiTepi++;
  var pola = polaString(s);
  if (e.pola[pola] !== undefined) e.pola[pola]++;
  else if (Object.keys(e.pola).length < PROFIL_BATAS_POLA) e.pola[pola] = 1;
  else e.polaLain++;
  if (!e.nilaiLuber) {
    if (s.length > PROFIL_PANJANG_ENUM) {
      e.nilaiLuber = true;
      e.nilai = {};
    } else if (e.nilai[s] !== undefined) {
      e.nilai[s]++;
    } else if (Object.keys(e.nilai).length < config.ENUM_MAKS) {
      e.nilai[s] = 1;
    } else {
      e.nilaiLuber = true;
      e.nilai = {};
    }
  }
}

function _telusuri(nilai, path, kedalaman, st, idxDoc, config, tz) {
  var e = _entriProfil(st, path);
  if (!e) return;
  if (e._doc !== idxDoc) {
    e.ada++;
    e._doc = idxDoc;
  }
  var t = tipeNilai(nilai);
  e.tipe[t] = (e.tipe[t] || 0) + 1;

  if (t === 'string') {
    _catatString(e, nilai, config);
  } else if (tipeAngka(t)) {
    var x = angkaDariNilai(nilai);
    if (x !== null) {
      if (x < 0) e.negatif++;
      if (x === 0) e.nol++;
      if (x % 1 !== 0) e.pecahan++;
    }
  } else if (t === 'date') {
    if (!isNaN(nilai.getTime())) {
      e.jumlahTanggal++;
      var j = jamLokal(nilai, tz);
      e.jam[j] = (e.jam[j] || 0) + 1;
      if (e.tglMin === null || nilai < e.tglMin) e.tglMin = nilai;
      if (e.tglMax === null || nilai > e.tglMax) e.tglMax = nilai;
    }
  } else if (t === 'array') {
    if (e.arrMin === null || nilai.length < e.arrMin) e.arrMin = nilai.length;
    if (e.arrMax === null || nilai.length > e.arrMax) e.arrMax = nilai.length;
    if (kedalaman < config.KEDALAMAN_MAKS) {
      for (var i = 0; i < nilai.length && i < PROFIL_BATAS_ELEMEN_ARRAY; i++) {
        _telusuri(nilai[i], path + '[]', kedalaman + 1, st, idxDoc, config, tz);
      }
    }
  } else if (t === 'object') {
    if (kedalaman < config.KEDALAMAN_MAKS) {
      for (var k in nilai) {
        if (Object.prototype.hasOwnProperty.call(nilai, k)) {
          _telusuri(nilai[k], path + '.' + k, kedalaman + 1, st, idxDoc, config, tz);
        }
      }
    }
  }
}

function _pathAmanServer(path) {
  if (path.indexOf('[]') >= 0) return false;
  var seg = path.split('.');
  for (var i = 0; i < seg.length; i++) {
    if (seg[i] === '' || seg[i].charAt(0) === '$') return false;
  }
  return true;
}

/** Ganti tipe hasil deteksi klien dengan $type dari server (bisa bedakan int/double/long/decimal) */
function _tipeDariServer(d, koleksi, docs, st) {
  if (!docs.length) return;
  var ids = [];
  var i;
  for (i = 0; i < docs.length; i++) ids.push(docs[i]._id);
  var paths = [];
  for (i = 0; i < st.urutan.length; i++) {
    if (_pathAmanServer(st.urutan[i])) paths.push(st.urutan[i]);
  }
  for (var mulai = 0; mulai < paths.length; mulai += 100) {
    var bagian = paths.slice(mulai, mulai + 100);
    var proyeksi = { _id: 0 };
    var j;
    for (j = 0; j < bagian.length; j++) proyeksi['t' + j] = { $type: '$' + bagian[j] };
    var baris = jalankanAgregasi(d, koleksi, [{ $match: { _id: { $in: ids } } }, { $project: proyeksi }]);
    var hitung = [];
    for (j = 0; j < bagian.length; j++) hitung.push({});
    for (var r = 0; r < baris.length; r++) {
      for (j = 0; j < bagian.length; j++) {
        var t = baris[r]['t' + j];
        if (t && t !== 'missing') hitung[j][t] = (hitung[j][t] || 0) + 1;
      }
    }
    for (j = 0; j < bagian.length; j++) {
      if (Object.keys(hitung[j]).length) {
        st.path[bagian[j]].tipe = hitung[j];
        st.path[bagian[j]].tipeSumber = 'server';
      }
    }
  }
}

function _ringkasEntri(path, e, jumlahDok, config, tz) {
  var info = {};
  var adaNilai = Object.keys(e.nilai).length;
  if (e.jumlahString > 0) {
    var enumCocok = config.TAMPILKAN_ENUM && !e.nilaiLuber && adaNilai > 0 && adaNilai * 2 <= e.jumlahString;
    if (enumCocok) info.nilai = teratas(e.nilai);
    else info.pola = teratas(e.pola, 3);
    var jumlahPola = Object.keys(e.pola).length + (e.polaLain ? 1 : 0);
    if (!enumCocok && jumlahPola > 3) info.polaLain = jumlahPola - 3;
    if (e.spasiTepi) info.spasiTepi = e.spasiTepi;
    if (e.kosong) info.kosong = e.kosong;
  }
  if (e.negatif) info.negatif = e.negatif;
  if (e.nol) info.nol = e.nol;
  if (e.pecahan) info.pecahan = e.pecahan;
  if (e.jumlahTanggal) {
    info.jam = teratas(e.jam, 3);
    info.jumlahTanggal = e.jumlahTanggal;
    info.tanggalMin = formatLokal(e.tglMin, tz, false);
    info.tanggalMax = formatLokal(e.tglMax, tz, false);
  }
  if (e.arrMin !== null) info.panjangArray = { min: e.arrMin, max: e.arrMax };
  return {
    path: path,
    ada: e.ada,
    adaPersen: jumlahDok ? Math.round((e.ada / jumlahDok) * 1000) / 10 : 0,
    tipe: e.tipe,
    tipeSumber: e.tipeSumber,
    info: info,
  };
}

function _profilKoleksi(ctx, nama, semuaKoleksi, n, mode, config) {
  if (semuaKoleksi.indexOf(nama) < 0) {
    return { koleksi: nama, ada: false, kandidat: kandidatNama(nama, semuaKoleksi, 5) };
  }
  var docs = ambilSampel(ctx.db, nama, n, mode);
  var st = { path: {}, urutan: [], terpotong: false };
  for (var i = 0; i < docs.length; i++) {
    for (var k in docs[i]) {
      if (Object.prototype.hasOwnProperty.call(docs[i], k)) _telusuri(docs[i][k], k, 1, st, i, config, ctx.tz);
    }
  }
  _tipeDariServer(ctx.db, nama, docs, st);
  var field = [];
  for (var p = 0; p < st.urutan.length; p++) {
    field.push(_ringkasEntri(st.urutan[p], st.path[st.urutan[p]], docs.length, config, ctx.tz));
  }
  var catatan = [];
  if (st.terpotong) catatan.push('Jumlah field melebihi ' + PROFIL_BATAS_PATH + '; sisanya tidak ditampilkan.');
  if (!docs.length) catatan.push('Koleksi kosong.');
  return {
    koleksi: nama,
    ada: true,
    estimasiDokumen: estimasiJumlahDokumen(ctx.db, nama),
    sampel: docs.length,
    field: field,
    catatan: catatan,
  };
}

function jalankan(config, mapping, ctx) {
  var n = angkaSampel(config.SAMPEL, 'SAMPEL');
  var mode = config.MODE_SAMPEL || 'terbaru';
  if (mode !== 'terbaru' && mode !== 'acak') throw new Error('CONFIG.MODE_SAMPEL harus "terbaru" atau "acak"');
  config.ENUM_MAKS = Number(config.ENUM_MAKS) > 0 ? Number(config.ENUM_MAKS) : 8;
  config.KEDALAMAN_MAKS = Number(config.KEDALAMAN_MAKS) > 0 ? Number(config.KEDALAMAN_MAKS) : 4;

  var daftar = config.KOLEKSI && config.KOLEKSI.length ? config.KOLEKSI.slice() : daftarKoleksiMapping(mapping);
  if (!daftar.length) throw new Error('Tidak ada koleksi untuk diprofil. Isi CONFIG.KOLEKSI atau MAPPING.');

  var semuaKoleksi = daftarNamaKoleksi(ctx.db);
  var koleksi = [];
  for (var i = 0; i < daftar.length; i++) koleksi.push(_profilKoleksi(ctx, daftar[i], semuaKoleksi, n, mode, config));
  return { sampelPerKoleksi: n, modeSampel: mode, tampilkanEnum: !!config.TAMPILKAN_ENUM, koleksi: koleksi };
}

function _teksTipe(tipe) {
  var total = 0;
  var k;
  for (k in tipe) total += tipe[k];
  var daftar = teratas(tipe);
  if (daftar.length === 1) return daftar[0].nilai;
  var bagian = [];
  for (var i = 0; i < daftar.length; i++) bagian.push(daftar[i].nilai + ' ' + fmtPersen(daftar[i].jumlah, total));
  return bagian.join(', ');
}

function _teksDaftar(daftar, total, kutip) {
  var bagian = [];
  for (var i = 0; i < daftar.length; i++) {
    var label = kutip ? JSON.stringify(daftar[i].nilai) : daftar[i].nilai;
    bagian.push(label + ' (' + (total ? fmtPersen(daftar[i].jumlah, total) : daftar[i].jumlah) + ')');
  }
  return bagian.join(', ');
}

function _teksInfo(f, tz) {
  var i = f.info;
  var bagian = [];
  if (i.jam) {
    bagian.push('jam ' + labelZona(tz) + ': ' + _teksDaftar(i.jam, i.jumlahTanggal, false));
    bagian.push('rentang ' + i.tanggalMin + ' s/d ' + i.tanggalMax);
  }
  if (i.nilai) bagian.push('nilai: ' + _teksDaftar(i.nilai, 0, true));
  if (i.pola) bagian.push('pola: ' + _teksDaftar(i.pola, 0, true) + (i.polaLain ? ' +' + i.polaLain + ' pola lain' : ''));
  if (i.spasiTepi) bagian.push('spasi di awal/akhir: ' + i.spasiTepi);
  if (i.kosong) bagian.push('string kosong: ' + i.kosong);
  var angka = [];
  if (i.negatif) angka.push('negatif ' + i.negatif);
  if (i.nol) angka.push('nol ' + i.nol);
  if (i.pecahan) angka.push('pecahan ' + i.pecahan);
  if (angka.length) bagian.push('angka: ' + angka.join(', '));
  if (i.panjangArray) bagian.push('panjang array ' + i.panjangArray.min + '-' + i.panjangArray.max);
  return bagian.join(' | ');
}

function render(hasil, ctx) {
  var baris = [];
  var tidakAda = 0;
  for (var i = 0; i < hasil.koleksi.length; i++) {
    var k = hasil.koleksi[i];
    baris.push('');
    baris.push('--- ' + k.koleksi + ' ' + new Array(Math.max(3, 74 - k.koleksi.length)).join('-'));
    if (!k.ada) {
      tidakAda++;
      baris.push('TIDAK DITEMUKAN.' + (k.kandidat.length ? ' Mungkin maksudnya: ' + k.kandidat.join(', ') : ''));
      continue;
    }
    baris.push('Estimasi dokumen: ' + fmtAngka(k.estimasiDokumen) + ' | sampel: ' + k.sampel + ' (' + hasil.modeSampel + ')');
    for (var c = 0; c < k.catatan.length; c++) baris.push('Catatan: ' + k.catatan[c]);
    if (!k.field.length) continue;
    var data = [];
    for (var f = 0; f < k.field.length; f++) {
      var fl = k.field[f];
      data.push({ path: fl.path, ada: fmtPersen(fl.ada, k.sampel), tipe: _teksTipe(fl.tipe), info: _teksInfo(fl, ctx.tz) });
    }
    baris = baris.concat(formatTabel([
      { judul: 'FIELD', kunci: 'path', maks: 40 },
      { judul: 'ADA', kunci: 'ada', kanan: true },
      { judul: 'TIPE', kunci: 'tipe', maks: 40 },
      { judul: 'INFO', kunci: 'info' },
    ], data));
  }
  baris.push('');
  baris.push('Selesai: ' + (hasil.koleksi.length - tidakAda) + ' koleksi diprofil' + (tidakAda ? ', ' + tidakAda + ' tidak ditemukan' : '') + '.');
  baris.push(hasil.tampilkanEnum
    ? 'Nilai asli hanya ditampilkan untuk field enum (variasi sedikit). Set TAMPILKAN_ENUM: false untuk menyamarkan semuanya.'
    : 'Semua nilai string disamarkan jadi pola.');
  return baris;
}
