/**
 * @nama 01-mutasi
 * @judul Mutasi stok per kode barang: rekap periode (saldo awal, masuk, keluar, saldo akhir) dan kartu stok
 */

// #region config
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
// #endregion

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

function _mutasiAmbilMaster(d, mapping, companyCode, kodeList, kategori) {
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
  var barisMinus = jalankanAgregasi(ctx.db, g.koleksi, g.pipeline.concat(tahapMinus(rentang)));
  var minus = {};
  var i;
  for (i = 0; i < barisMinus.length; i++) minus[String(barisMinus[i]._id)] = barisMinus[i];

  for (i = 0; i < rekap.length; i++) {
    var r = rekap[i];
    var kunciKode = r.kodeBarang === null ? '(kosong)' : String(r.kodeBarang);
    var m = master.ada && typeof r.kodeBarang === 'string' ? master.peta[r.kodeBarang] || null : null;
    var infoMinus = minus[kunciKode] || null;
    r.master = m ? { nama: m.nama, kategori: m.kategori, satuan: m.satuan } : null;
    r.minus = infoMinus
      ? {
        tanggal: infoMinus.tanggal,
        saldo: bulatkan(infoMinus.saldo),
        asal: infoMinus.asal,
        arah: infoMinus.arah,
        qty: infoMinus.qty,
        docId: infoMinus.docId,
        idAsal: infoMinus.idAsal,
        saldoMin: bulatkan(infoMinus.saldoMin),
        barisMinus: infoMinus.barisMinus,
      }
      : null;
    r.tanda = tandaiRekap(r, { master: m, cekMaster: master.ada, minus: infoMinus });
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

  var saldo = r ? r.awal : 0;
  var minusPertama = null;
  for (var i = 0; i < baris.length; i++) {
    saldo = bulatkan(saldo + baris[i].qtyBertanda);
    baris[i].saldo = saldo;
    if (!minusPertama && saldo < -EPS_MUTASI) minusPertama = baris[i];
  }
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
      satuan: b.satuan,
      docId: b.docId,
      idAsal: b.idAsal,
      dokSumber: b.dokSumber || null,
      cek: b.cek === undefined ? null : b.cek,
    });
  }
  var m = master.ada ? master.peta[kode.trim()] || null : null;
  var tanda = r ? tandaiRekap(r, { master: m, cekMaster: master.ada, minus: minusPertama }) : [];
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
    minusPertama: minusPertama
      ? { tanggal: minusPertama.tanggal, asal: minusPertama.asal, arah: minusPertama.arah, qty: minusPertama.qty, saldo: minusPertama.saldo, docId: minusPertama.docId, dokSumber: minusPertama.dokSumber || null }
      : null,
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
    var masterKategori = _mutasiAmbilMaster(ctx.db, mapping, config.COMPANY_CODE, kodeList, config.KATEGORI);
    kodeList = Object.keys(masterKategori.peta).sort();
  }
  var master = _mutasiAmbilMaster(ctx.db, mapping, config.COMPANY_CODE, kodeList, null);
  if (mode === 'kartu') return _mutasiKartu(config, mapping, ctx, rentang, cutoff, kunci, kodeList, master);
  return _mutasiRekap(config, mapping, ctx, rentang, cutoff, kunci, kodeList, master);
}

// ----------------------------------------------------------------- render

function _mutasiAngka(n) {
  return n === null || n === undefined ? '' : fmtAngka(n, 'auto');
}

function _mutasiSatuan(satuan) {
  var k = Object.keys(satuan || {});
  return k.length ? k.join('+') : '';
}

function _mutasiTeksMinus(m, tz) {
  if (!m) return '';
  return formatLokal(m.tanggal, tz).slice(0, 16) + ' | ' + m.asal + ' ' + m.arah + ' ' + _mutasiAngka(m.qty) +
    ' | saldo ' + _mutasiAngka(m.saldo);
}

function _mutasiRenderRekap(h, ctx, config) {
  var baris = [];
  baris.push('Periode : ' + h.periode + ' | companyCode ' + (h.companyCode ? JSON.stringify(h.companyCode) : '(semua)') +
    (h.kategori ? ' | kategori ' + JSON.stringify(h.kategori) : ''));
  baris.push('Dihitung dari sumber: ' + h.sumberDihitung.join(', ') + (h.cutoff ? ' | cut-off ' + h.cutoff : ''));
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
  for (var k = 0; k < tampil.length; k++) if (tampil[k].minus) adaMinus.push(tampil[k]);
  if (adaMinus.length) {
    baris.push('');
    baris.push('Transaksi pertama yang membuat saldo minus di periode ini:');
    for (var z = 0; z < adaMinus.length; z++) {
      baris.push('  ' + adaMinus[z].kodeBarang + ' : ' + _mutasiTeksMinus(adaMinus[z].minus, ctx.tz) +
        ' | saldo terendah ' + _mutasiAngka(adaMinus[z].minus.saldoMin) + ' (' + adaMinus[z].minus.barisMinus + ' baris minus)');
    }
    baris.push('Telusuri per transaksi dengan MODE: "kartu" dan KODE_BARANG berisi kode di atas.');
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
      ' | satuan master ' + (k.master.satuan || '-') : ' | (tidak ada di master)');
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
    if (k.minusPertama) {
      var ds2 = k.minusPertama.dokSumber || {};
      baris.push('Saldo pertama kali minus: ' + _mutasiTeksMinus(k.minusPertama, ctx.tz) + (ds2.noTransaksi ? ' | ' + ds2.noTransaksi : ''));
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
