/**
 * @nama 00-cek-mapping
 * @judul Cek kecocokan MAPPING dengan data asli: koleksi, field, tipe, arah, dan relasi header
 */

// #region config
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
// #endregion

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
