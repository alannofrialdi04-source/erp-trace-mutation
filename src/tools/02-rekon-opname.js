/**
 * @nama 02-rekon-opname
 * @judul Rekonsiliasi saldo buku (ledger) dengan dokumen hitung fisik (MONSUS / stock opname) per kode barang
 */

// #region config
var CONFIG = {
  // Dokumen hitung fisik: nama di MAPPING.opname ('monsus' | 'stokopname')
  OPNAME: 'monsus',

  // Nomor registrasi dokumen. Sebaiknya diisi supaya tidak mencampur beberapa dokumen.
  NO_REG: 'MONSUS20260131-00001',

  // Nomor BAP (opsional). Satu noReg bisa berisi beberapa BAP.
  NO_BAP: 'BAP-03',

  // Tanggal saldo buku (YYYY-MM-DD, zona waktu MAPPING). Saldo dihitung s/d akhir hari tanggal ini.
  // null = tanggal dari dokumen opname (harus satu tanggal)
  TANGGAL: null,

  // Filter companyCode. null = semua company
  COMPANY_CODE: 'WAG',

  // Batasi kedua sisi ke kategori master barang, mis. 'MATERIAL'. null = semua.
  KATEGORI: null,

  // Selisih absolut di bawah nilai ini dianggap cocok
  TOLERANSI: 0.0001,

  // Teks: 'selisih' = hanya kode yang tidak cocok | 'semua'
  TAMPIL: 'selisih',

  // Teks: maksimal baris yang ditampilkan (FORMAT 'json' selalu lengkap)
  TAMPIL_MAKS: 300,

  // Database: null = database aktif di koneksi
  DB: null,

  // 'teks' | 'json'
  FORMAT: 'teks',
};
// #endregion

var REKON_STATUS = ['SELISIH', 'HANYA_BUKU', 'HANYA_OPNAME', 'COCOK'];

function _rekonOpname(d, def, config, kodeKategori) {
  var f = def.field;
  var match = {};
  if (config.COMPANY_CODE && f.companyCode) match[f.companyCode] = config.COMPANY_CODE;
  if (config.NO_REG) {
    if (!f.noReg) throw new Error('CONFIG.NO_REG butuh field noReg di MAPPING.opname');
    match[f.noReg] = config.NO_REG;
  }
  if (config.NO_BAP) {
    if (!f.noBap) throw new Error('CONFIG.NO_BAP butuh field noBap di MAPPING.opname');
    match[f.noBap] = config.NO_BAP;
  }
  var kode = '$' + f.kodeBarang;
  var pipeline = [
    { $match: match },
    {
      $project: {
        _id: 0,
        kode: { $cond: [{ $eq: [{ $type: kode }, 'string'] }, { $trim: { input: kode } }, { $ifNull: [kode, null] }] },
        qty: { $convert: { input: '$' + f.qty, to: 'double', onError: null, onNull: null } },
        tanggal: '$' + f.tanggal,
        satuan: f.satuan ? { $ifNull: ['$' + f.satuan, null] } : { $literal: null },
        nama: f.nama ? { $ifNull: ['$' + f.nama, null] } : { $literal: null },
      },
    },
  ];
  if (kodeKategori) pipeline.push({ $match: { kode: { $in: kodeKategori } } });
  pipeline.push({
    $group: {
      _id: '$kode',
      qty: { $sum: { $ifNull: ['$qty', 0] } },
      baris: { $sum: 1 },
      qtyKosong: { $sum: { $cond: [{ $eq: ['$qty', null] }, 1, 0] } },
      satuan: { $addToSet: '$satuan' },
      nama: { $first: '$nama' },
      tglMin: { $min: '$tanggal' },
      tglMax: { $max: '$tanggal' },
    },
  });
  return jalankanAgregasi(d, def.koleksi, pipeline);
}

function _rekonTanggalOpname(barisOpname, tz) {
  var tanggal = {};
  for (var i = 0; i < barisOpname.length; i++) {
    var daftar = [barisOpname[i].tglMin, barisOpname[i].tglMax];
    for (var j = 0; j < daftar.length; j++) {
      if (daftar[j] instanceof Date) tanggal[formatLokal(daftar[j], tz, false)] = true;
    }
  }
  return Object.keys(tanggal).sort();
}

function _rekonBuku(d, mapping, config, batas, kodeKategori) {
  var g = pipelineGabungan(mapping, sumberDihitung(mapping), { companyCode: config.COMPANY_CODE || null, kodeBarang: kodeKategori });
  return jalankanAgregasi(d, g.koleksi, g.pipeline.concat([
    { $match: { tanggalTipe: 'date', tanggal: { $lt: batas } } },
    {
      $group: {
        _id: '$kodeBarang',
        saldo: { $sum: '$qtyBertanda' },
        satuan: { $addToSet: '$satuan' },
        dok: { $sum: 1 },
      },
    },
  ]));
}

function _rekonSatuan(daftar) {
  var hasil = [];
  for (var i = 0; i < (daftar || []).length; i++) {
    var s = daftar[i] === null || daftar[i] === undefined ? '' : String(daftar[i]).trim();
    if (s !== '' && hasil.indexOf(s) < 0) hasil.push(s);
  }
  return hasil.sort();
}

function jalankan(config, mapping, ctx) {
  var validasi = validasiMapping(mapping);
  if (validasi.error.length) {
    throw new Error('MAPPING tidak valid: ' + validasi.error[0].path + ': ' + validasi.error[0].pesan);
  }
  if (!mapping.opname || !mapping.opname[config.OPNAME]) {
    throw new Error('CONFIG.OPNAME "' + config.OPNAME + '" tidak ada di MAPPING.opname' +
      (mapping.opname ? ' (tersedia: ' + Object.keys(mapping.opname).join(', ') + ')' : ''));
  }
  var toleransi = Number(config.TOLERANSI);
  if (!isFinite(toleransi) || toleransi < 0) throw new Error('CONFIG.TOLERANSI harus angka >= 0');
  var tampil = String(config.TAMPIL || 'selisih');
  if (tampil !== 'selisih' && tampil !== 'semua') throw new Error('CONFIG.TAMPIL harus "selisih" atau "semua"');
  var def = mapping.opname[config.OPNAME];
  var catatan = [];

  // master & kategori
  var master = ambilMaster(ctx.db, mapping, config.COMPANY_CODE, null, null);
  var kodeKategori = null;
  if (config.KATEGORI) {
    kodeKategori = Object.keys(ambilMaster(ctx.db, mapping, config.COMPANY_CODE, null, config.KATEGORI).peta).sort();
    catatan.push('Filter kategori ' + JSON.stringify(config.KATEGORI) + ' memakai master barang; kode yang tidak ada di master tidak ikut.');
  }

  var barisOpname = _rekonOpname(ctx.db, def, config, kodeKategori);
  if (!barisOpname.length) throw new Error('Tidak ada dokumen opname yang cocok dengan filter (OPNAME/NO_REG/NO_BAP/COMPANY_CODE/KATEGORI).');

  var tanggal = config.TANGGAL ? String(config.TANGGAL) : null;
  if (!tanggal) {
    var daftarTanggal = _rekonTanggalOpname(barisOpname, ctx.tz);
    if (daftarTanggal.length !== 1) {
      throw new Error('Dokumen opname punya ' + daftarTanggal.length + ' tanggal berbeda (' + daftarTanggal.join(', ') +
        '). Isi CONFIG.TANGGAL atau persempit NO_REG/NO_BAP.');
    }
    tanggal = daftarTanggal[0];
  }
  var batas = awalHariLokal(geserHari(tanggal, 1), ctx.tz);
  var barisBuku = _rekonBuku(ctx.db, mapping, config, batas, kodeKategori);

  var perKode = {};
  var i;
  for (i = 0; i < barisOpname.length; i++) {
    var o = barisOpname[i];
    var ko = o._id === null || o._id === undefined ? '(kosong)' : String(o._id);
    perKode[ko] = {
      kodeBarang: o._id === undefined ? null : o._id,
      fisik: bulatkan(o.qty),
      barisOpname: o.baris,
      qtyOpnameKosong: o.qtyKosong,
      satuanOpname: _rekonSatuan(o.satuan),
      namaOpname: o.nama,
      buku: null,
      satuanBuku: [],
    };
  }
  for (i = 0; i < barisBuku.length; i++) {
    var b = barisBuku[i];
    var kb = b._id === null || b._id === undefined ? '(kosong)' : String(b._id);
    var r = perKode[kb];
    if (!r) {
      if (Math.abs(b.saldo) <= toleransi) continue; // saldo nol & tidak ada di opname: tidak relevan
      r = { kodeBarang: b._id === undefined ? null : b._id, fisik: null, barisOpname: 0, qtyOpnameKosong: 0, satuanOpname: [], namaOpname: null };
      perKode[kb] = r;
    }
    r.buku = bulatkan(b.saldo);
    r.satuanBuku = _rekonSatuan(b.satuan);
    r.dokBuku = b.dok;
  }

  var ringkasan = { jumlahKode: 0, status: {}, totalFisik: 0, totalBuku: 0, totalSelisihAbsolut: 0 };
  var hasil = [];
  for (var kunci in perKode) {
    var x = perKode[kunci];
    var m = master.ada && typeof x.kodeBarang === 'string' ? master.peta[x.kodeBarang] || null : null;
    x.master = m ? { nama: m.nama, kategori: m.kategori, satuan: m.satuan } : null;
    if (x.fisik === null) x.status = 'HANYA_BUKU';
    else if (x.buku === null) x.status = Math.abs(x.fisik) <= toleransi ? 'COCOK' : 'HANYA_OPNAME';
    else x.status = Math.abs(x.fisik - x.buku) <= toleransi ? 'COCOK' : 'SELISIH';
    x.selisih = bulatkan((x.fisik === null ? 0 : x.fisik) - (x.buku === null ? 0 : x.buku));
    x.tanda = [];
    if (master.ada && !m) x.tanda.push('TIDAK_DI_MASTER');
    if (x.satuanBuku.length > 1) x.tanda.push('SATUAN_CAMPUR');
    if (x.buku !== null && x.buku < -toleransi) x.tanda.push('BUKU_MINUS');
    if (x.qtyOpnameKosong) x.tanda.push('QTY_OPNAME_KOSONG');
    if (x.barisOpname > 1) x.tanda.push('OPNAME_GANDA');
    ringkasan.status[x.status] = (ringkasan.status[x.status] || 0) + 1;
    ringkasan.totalFisik = bulatkan(ringkasan.totalFisik + (x.fisik || 0));
    ringkasan.totalBuku = bulatkan(ringkasan.totalBuku + (x.buku || 0));
    ringkasan.totalSelisihAbsolut = bulatkan(ringkasan.totalSelisihAbsolut + Math.abs(x.selisih));
    hasil.push(x);
  }
  hasil.sort(function (p, q) {
    var sp = REKON_STATUS.indexOf(p.status);
    var sq = REKON_STATUS.indexOf(q.status);
    if (sp !== sq) return sp - sq;
    var d = Math.abs(q.selisih) - Math.abs(p.selisih);
    if (d !== 0) return d;
    return String(p.kodeBarang) < String(q.kodeBarang) ? -1 : 1;
  });
  ringkasan.jumlahKode = hasil.length;

  return {
    opname: config.OPNAME,
    labelOpname: def.label || config.OPNAME,
    noReg: config.NO_REG || null,
    noBap: config.NO_BAP || null,
    tanggal: tanggal,
    batasBuku: batas,
    companyCode: config.COMPANY_CODE || null,
    kategori: config.KATEGORI || null,
    toleransi: toleransi,
    sumberDihitung: sumberDihitung(mapping),
    ringkasan: ringkasan,
    kode: hasil,
    catatan: catatan,
  };
}

function render(h, ctx, config) {
  var baris = [];
  baris.push('Opname : ' + h.labelOpname + ' | noReg ' + (h.noReg || '(semua)') + (h.noBap ? ' | BAP ' + h.noBap : '') +
    ' | companyCode ' + (h.companyCode ? JSON.stringify(h.companyCode) : '(semua)') + (h.kategori ? ' | kategori ' + JSON.stringify(h.kategori) : ''));
  baris.push('Saldo buku: ' + h.sumberDihitung.join(', ') + ' s/d akhir ' + h.tanggal + ' ' + labelZona(ctx.tz) +
    ' (transaksi < ' + formatLokal(h.batasBuku, ctx.tz) + ') | toleransi ' + h.toleransi);
  for (var c = 0; c < h.catatan.length; c++) baris.push('Catatan: ' + h.catatan[c]);
  var status = [];
  for (var s = 0; s < REKON_STATUS.length; s++) {
    if (h.ringkasan.status[REKON_STATUS[s]]) status.push(REKON_STATUS[s] + ' ' + fmtAngka(h.ringkasan.status[REKON_STATUS[s]]));
  }
  baris.push('Ringkasan: ' + fmtAngka(h.ringkasan.jumlahKode) + ' kode | ' + status.join(' | '));
  baris.push('Total fisik ' + fmtAngka(h.ringkasan.totalFisik, 'auto') + ' | total buku ' + fmtAngka(h.ringkasan.totalBuku, 'auto') +
    ' | total selisih absolut ' + fmtAngka(h.ringkasan.totalSelisihAbsolut, 'auto') + ' (campuran satuan, hanya indikasi)');
  baris.push('Selisih = fisik - buku. Positif: fisik lebih banyak dari buku. Negatif: buku lebih banyak dari fisik.');

  var tampil = [];
  for (var i = 0; i < h.kode.length; i++) {
    if (config.TAMPIL === 'semua' || h.kode[i].status !== 'COCOK') tampil.push(h.kode[i]);
  }
  var maks = Number(config.TAMPIL_MAKS) > 0 ? Number(config.TAMPIL_MAKS) : 300;
  var dipotong = tampil.length > maks;
  tampil = tampil.slice(0, maks);
  baris.push('');
  if (!tampil.length) {
    baris.push('Semua kode cocok.');
    return baris;
  }
  var data = [];
  for (var j = 0; j < tampil.length; j++) {
    var x = tampil[j];
    data.push({
      kode: x.kodeBarang === null ? '(kosong)' : x.kodeBarang,
      nama: x.master && x.master.nama ? x.master.nama : x.namaOpname || '',
      kat: x.master && x.master.kategori ? x.master.kategori : '',
      sat: x.satuanBuku.join('+') || (x.master && x.master.satuan) || '',
      buku: x.buku === null ? '-' : fmtAngka(x.buku, 'auto'),
      fisik: x.fisik === null ? '-' : fmtAngka(x.fisik, 'auto'),
      selisih: fmtAngka(x.selisih, 'auto'),
      status: x.status,
      tanda: x.tanda.join(','),
    });
  }
  baris = baris.concat(formatTabel([
    { judul: 'KODE', kunci: 'kode', maks: 30 },
    { judul: 'NAMA', kunci: 'nama', maks: 28 },
    { judul: 'KATEGORI', kunci: 'kat', maks: 20 },
    { judul: 'SAT', kunci: 'sat', maks: 12 },
    { judul: 'BUKU', kunci: 'buku', kanan: true },
    { judul: 'FISIK', kunci: 'fisik', kanan: true },
    { judul: 'SELISIH', kunci: 'selisih', kanan: true },
    { judul: 'STATUS', kunci: 'status' },
    { judul: 'TANDA', kunci: 'tanda' },
  ], data));
  if (dipotong) baris.push('... ditampilkan ' + maks + ' kode. Pakai FORMAT: "json" untuk daftar lengkap.');
  return baris;
}
