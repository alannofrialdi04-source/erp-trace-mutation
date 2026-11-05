/**
 * @nama 03-cek-tanggal
 * @judul Tanggal transaksi vs tanggal registrasi di nomor dokumen: deteksi salah ketik tahun & backdate ekstrem
 */

// #region config
var CONFIG = {
  // Filter companyCode. null = semua company
  COMPANY_CODE: 'WAG',

  // Sumber yang dicek (nama di MAPPING.sumber). [] = semua sumber yang punya field noTransaksi.
  SUMBER: [],

  // Opsional: batasi ke periode tanggal transaksi. '2026-01' | '2025' | { dari, sampai } | null = semua
  PERIODE: null,

  // Pola tanggal registrasi di nomor transaksi (regex, 3 grup: tahun, bulan, tanggal).
  // Cocok untuk GRN20251003-00383, OUTWH20260113-00003, TRFCUTTING20251208-00018, SCP-20251129-00001.
  POLA_TANGGAL_REG: '(20\\d{2})(\\d{2})(\\d{2})',

  // Transaksi bertanggal lebih dari N hari SEBELUM tanggal registrasi -> MUNDUR_JAUH
  BATAS_MUNDUR_HARI: 60,

  // Transaksi bertanggal lebih dari N hari SESUDAH tanggal registrasi -> MAJU
  BATAS_MAJU_HARI: 1,

  // Teks: maksimal baris anomali per sumber (FORMAT 'json' memuat sampai BATAS_BARIS)
  TAMPIL_MAKS: 50,

  // Maksimal anomali yang diambil per sumber
  BATAS_BARIS: 5000,

  // Database: null = database aktif di koneksi
  DB: null,

  // 'teks' | 'json'
  FORMAT: 'teks',
};
// #endregion

var TGL_BUCKET = ['MAJU', 'SESUAI', 'MUNDUR_1_7', 'MUNDUR_8_30', 'MUNDUR_31_60', 'MUNDUR_LEBIH_60', 'TANPA_TGL_REG', 'TANPA_TANGGAL'];

function _tglAngka(nilai, nama, min) {
  var n = Number(nilai);
  if (!isFinite(n) || n < min || Math.floor(n) !== n) throw new Error('CONFIG.' + nama + ' harus bilangan bulat >= ' + min);
  return n;
}

function _tglSumberDicek(mapping, config) {
  var semua = Object.keys(mapping.sumber);
  var eksplisit = config.SUMBER && config.SUMBER.length;
  var daftar = eksplisit ? config.SUMBER : semua;
  var hasil = [];
  for (var i = 0; i < daftar.length; i++) {
    var s = mapping.sumber[daftar[i]];
    if (!s) throw new Error('Sumber "' + daftar[i] + '" tidak ada di MAPPING. Yang tersedia: ' + semua.join(', '));
    if (!lokasiField(s, 'noTransaksi')) {
      if (eksplisit) throw new Error('Sumber "' + daftar[i] + '" tidak punya field noTransaksi di MAPPING');
      continue;
    }
    hasil.push(daftar[i]);
  }
  return hasil;
}

/** Tahap tambahan: tanggal registrasi dari nomor transaksi & selisih hari (tanggal lokal) */
function _tglTahap(pola, tz) {
  var reg = '$__reg.captures';
  return [
    {
      $addFields: {
        __reg: { $regexFind: { input: { $convert: { input: '$noTransaksi', to: 'string', onError: '', onNull: '' } }, regex: pola } },
      },
    },
    {
      $addFields: {
        __tglReg: {
          $cond: [
            { $eq: ['$__reg', null] },
            null,
            {
              $dateFromString: {
                dateString: { $concat: [{ $arrayElemAt: [reg, 0] }, '-', { $arrayElemAt: [reg, 1] }, '-', { $arrayElemAt: [reg, 2] }] },
                format: '%Y-%m-%d', timezone: tz, onError: null, onNull: null,
              },
            },
          ],
        },
        __tglLokal: {
          $cond: [
            { $eq: ['$tanggalTipe', 'date'] },
            {
              $dateFromString: {
                dateString: { $dateToString: { format: '%Y-%m-%d', date: '$tanggal', timezone: tz } },
                format: '%Y-%m-%d', timezone: tz,
              },
            },
            null,
          ],
        },
      },
    },
    {
      $addFields: {
        __selisih: {
          $cond: [
            { $and: [{ $ne: ['$__tglReg', null] }, { $ne: ['$__tglLokal', null] }] },
            { $round: [{ $divide: [{ $subtract: ['$__tglLokal', '$__tglReg'] }, 86400000] }, 0] },
            null,
          ],
        },
      },
    },
  ];
}

function _tglBucket(batasMaju) {
  return {
    $switch: {
      branches: [
        { case: { $eq: ['$__tglReg', null] }, then: 'TANPA_TGL_REG' },
        { case: { $eq: ['$__selisih', null] }, then: 'TANPA_TANGGAL' },
        { case: { $gt: ['$__selisih', batasMaju] }, then: 'MAJU' },
        { case: { $gte: ['$__selisih', 0] }, then: 'SESUAI' },
        { case: { $gte: ['$__selisih', -7] }, then: 'MUNDUR_1_7' },
        { case: { $gte: ['$__selisih', -30] }, then: 'MUNDUR_8_30' },
        { case: { $gte: ['$__selisih', -60] }, then: 'MUNDUR_31_60' },
      ],
      default: 'MUNDUR_LEBIH_60',
    },
  };
}

function _tglCekSumber(ctx, mapping, kunci, config, rentang) {
  var s = mapping.sumber[kunci];
  var filter = { companyCode: config.COMPANY_CODE || null };
  if (rentang) filter.tanggal = { gte: rentang.gte, lt: rentang.lt };
  var dasar = bangunPipelineSumber(kunci, s, { filter: filter }).concat(_tglTahap(config.POLA_TANGGAL_REG, ctx.tz));

  var baris = jalankanAgregasi(ctx.db, s.koleksi, dasar.concat([
    { $group: { _id: _tglBucket(config.BATAS_MAJU_HARI), n: { $sum: 1 } } },
  ]));
  var distribusi = {};
  var total = 0;
  for (var i = 0; i < baris.length; i++) {
    distribusi[baris[i]._id] = baris[i].n;
    total += baris[i].n;
  }

  var anomali = jalankanAgregasi(ctx.db, s.koleksi, dasar.concat([
    {
      $match: {
        __selisih: { $ne: null },
        $or: [{ __selisih: { $lt: -config.BATAS_MUNDUR_HARI } }, { __selisih: { $gt: config.BATAS_MAJU_HARI } }],
      },
    },
    { $addFields: { __abs: { $abs: '$__selisih' } } },
    { $sort: { __abs: -1, noTransaksi: 1 } },
    { $limit: config.BATAS_BARIS + 1 },
    {
      $project: {
        _id: 0, docId: 1, noTransaksi: 1, kodeBarang: 1, qty: 1, satuan: 1, tanggal: 1, tglReg: '$__tglReg', selisih: '$__selisih',
      },
    },
  ]));
  var terpotong = anomali.length > config.BATAS_BARIS;
  if (terpotong) anomali = anomali.slice(0, config.BATAS_BARIS);

  var salahTahun = 0;
  for (var j = 0; j < anomali.length; j++) {
    var a = anomali[j];
    a.jenis = a.selisih < 0 ? 'MUNDUR_JAUH' : 'MAJU';
    var geser = dugaanSalahTahun(a.selisih, config.BATAS_MUNDUR_HARI);
    if (geser !== 0) {
      salahTahun++;
      a.dugaan = 'SALAH_TAHUN';
      a.saranTanggal = geserTahun(formatLokal(a.tanggal, ctx.tz, false), geser);
    } else {
      a.dugaan = null;
      a.saranTanggal = null;
    }
  }
  return {
    sumber: kunci,
    label: s.label || kunci,
    koleksi: s.koleksi,
    jumlahDok: total,
    distribusi: distribusi,
    jumlahAnomali: anomali.length,
    jumlahSalahTahun: salahTahun,
    terpotong: terpotong,
    anomali: anomali,
  };
}

function jalankan(config, mapping, ctx) {
  var validasi = validasiMapping(mapping);
  if (validasi.error.length) throw new Error('MAPPING tidak valid: ' + validasi.error[0].path + ': ' + validasi.error[0].pesan);
  config.BATAS_MUNDUR_HARI = _tglAngka(config.BATAS_MUNDUR_HARI, 'BATAS_MUNDUR_HARI', 0);
  config.BATAS_MAJU_HARI = _tglAngka(config.BATAS_MAJU_HARI, 'BATAS_MAJU_HARI', 0);
  config.BATAS_BARIS = _tglAngka(config.BATAS_BARIS, 'BATAS_BARIS', 1);
  if (typeof config.POLA_TANGGAL_REG !== 'string' || config.POLA_TANGGAL_REG === '') {
    throw new Error('CONFIG.POLA_TANGGAL_REG wajib berupa regex (teks) dengan 3 grup: tahun, bulan, tanggal');
  }
  var rentang = config.PERIODE ? rentangPeriode(config.PERIODE, ctx.tz) : null;
  var kunci = _tglSumberDicek(mapping, config);
  if (!kunci.length) throw new Error('Tidak ada sumber dengan field noTransaksi di MAPPING');

  var hasil = [];
  var ringkasan = { jumlahDok: 0, anomali: 0, salahTahun: 0 };
  for (var i = 0; i < kunci.length; i++) {
    var h = _tglCekSumber(ctx, mapping, kunci[i], config, rentang);
    ringkasan.jumlahDok += h.jumlahDok;
    ringkasan.anomali += h.jumlahAnomali;
    ringkasan.salahTahun += h.jumlahSalahTahun;
    hasil.push(h);
  }
  return {
    companyCode: config.COMPANY_CODE || null,
    periode: rentang ? rentang.label : null,
    batasMundurHari: config.BATAS_MUNDUR_HARI,
    batasMajuHari: config.BATAS_MAJU_HARI,
    ringkasan: ringkasan,
    sumber: hasil,
  };
}

function render(hasil, ctx, config) {
  var baris = [];
  baris.push('companyCode ' + (hasil.companyCode ? JSON.stringify(hasil.companyCode) : '(semua)') +
    (hasil.periode ? ' | periode ' + hasil.periode : ' | semua tanggal') +
    ' | anomali: lebih dari ' + hasil.batasMundurHari + ' hari sebelum registrasi atau lebih dari ' + hasil.batasMajuHari +
    ' hari sesudahnya');
  baris.push('Ringkasan: ' + fmtAngka(hasil.ringkasan.jumlahDok) + ' dokumen dicek | ' + fmtAngka(hasil.ringkasan.anomali) +
    ' anomali | ' + fmtAngka(hasil.ringkasan.salahTahun) + ' dugaan salah ketik tahun');
  baris.push('Selisih = tanggal transaksi - tanggal registrasi di nomor dokumen (hari). Negatif = transaksi dicatat mundur (backdate).');
  baris.push('SESUAI = selisih 0 s/d +' + hasil.batasMajuHari + ' hari. SALAH_TAHUN = selisih hampir tepat kelipatan 1 tahun (dugaan salah ketik tahun).');
  var maks = Number(config.TAMPIL_MAKS) > 0 ? Number(config.TAMPIL_MAKS) : 50;
  for (var i = 0; i < hasil.sumber.length; i++) {
    var s = hasil.sumber[i];
    baris.push('');
    var judul = s.sumber + ' (' + s.koleksi + ') | ' + fmtAngka(s.jumlahDok) + ' dokumen';
    baris.push('--- ' + judul + ' ' + new Array(Math.max(3, 74 - judul.length)).join('-'));
    var dist = [];
    for (var b = 0; b < TGL_BUCKET.length; b++) {
      if (s.distribusi[TGL_BUCKET[b]]) dist.push(TGL_BUCKET[b] + ' ' + fmtAngka(s.distribusi[TGL_BUCKET[b]]));
    }
    baris.push('Sebaran: ' + (dist.length ? dist.join(' | ') : '-'));
    if (!s.anomali.length) {
      baris.push('Tidak ada anomali.');
      continue;
    }
    var data = [];
    for (var j = 0; j < s.anomali.length && j < maks; j++) {
      var a = s.anomali[j];
      data.push({
        tgl: formatLokal(a.tanggal, ctx.tz, false),
        reg: formatLokal(a.tglReg, ctx.tz, false),
        sel: fmtAngka(a.selisih),
        no: a.noTransaksi || '',
        kode: a.kodeBarang === null ? '(kosong)' : a.kodeBarang,
        qty: fmtAngka(a.qty, 'auto'),
        dugaan: a.dugaan ? a.dugaan + (a.saranTanggal ? ' -> ' + a.saranTanggal : '') : a.jenis,
      });
    }
    baris = baris.concat(formatTabel([
      { judul: 'TANGGAL', kunci: 'tgl' },
      { judul: 'TGL REG', kunci: 'reg' },
      { judul: 'SELISIH', kunci: 'sel', kanan: true },
      { judul: 'NO. TRANSAKSI', kunci: 'no', maks: 32 },
      { judul: 'KODE', kunci: 'kode', maks: 24 },
      { judul: 'QTY', kunci: 'qty', kanan: true },
      { judul: 'JENIS / DUGAAN', kunci: 'dugaan' },
    ], data));
    if (s.anomali.length > maks) baris.push('... ditampilkan ' + maks + ' dari ' + fmtAngka(s.anomali.length) + ' anomali. Pakai FORMAT: "json" untuk daftar lengkap.');
    if (s.terpotong) baris.push('Catatan: anomali dibatasi BATAS_BARIS (' + fmtAngka(config.BATAS_BARIS) + ').');
  }
  return baris;
}
