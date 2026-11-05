/**
 * Perhitungan mutasi: gabungan sumber yang dihitung, rekap saldo per kode barang,
 * deteksi saldo minus (saldo berjalan), dan pembandingan baris ledger dengan dokumen sumbernya.
 *
 * Fungsi di file ini murni (menyusun pipeline / mengolah hasil), tidak menjalankan query.
 *
 * Model saldo:  saldo akhir = saldo awal + masuk - keluar
 *   saldo awal = akumulasi semua transaksi SEBELUM periode
 *   masuk/keluar = transaksi DI DALAM periode (batas atas eksklusif, zona waktu MAPPING)
 */

// #region node-only
var _mm = require('./mapping');
var sumberRujukan = _mm.sumberRujukan;
var bangunPipelineSumber = require('./sumber').bangunPipelineSumber;
var formatLokal = require('./tanggal').formatLokal;
var POLA_HEX24 = /^[0-9a-f]{24}$/i;
// #endregion

var EPS_MUTASI = 1e-6;
var URUTAN_TANDA = [
  'MINUS', 'AWAL_MINUS', 'PERNAH_MINUS', 'TIDAK_DI_MASTER', 'SATUAN_CAMPUR', 'SEBELUM_CUTOFF',
  'ARAH_TIDAK_DIKENAL', 'QTY_KOSONG', 'TANPA_TANGGAL',
];

function bulatkan(n) {
  return Math.round(n * 1e6) / 1e6;
}

/** Nama sumber yang ikut dihitung (hitungMutasi bukan false), sesuai urutan di MAPPING */
function sumberDihitung(mapping) {
  var hasil = [];
  var kunci = Object.keys(mapping.sumber || {});
  for (var i = 0; i < kunci.length; i++) {
    if (mapping.sumber[kunci[i]] && mapping.sumber[kunci[i]].hitungMutasi !== false) hasil.push(kunci[i]);
  }
  return hasil;
}

/**
 * Pipeline gabungan semua sumber yang dihitung ($unionWith), dijalankan di koleksi sumber pertama.
 * Field tambahan per baris: asal (fallback nama sumber), qtyBertanda (+IN / -OUT), urutArah (IN dulu).
 */
function pipelineGabungan(mapping, kunciSumber, filterLogis) {
  if (!kunciSumber.length) throw new Error('Tidak ada sumber yang dihitung (semua hitungMutasi: false)');
  var pertama = kunciSumber[0];
  var pipeline = bangunPipelineSumber(pertama, mapping.sumber[pertama], { filter: filterLogis });
  for (var i = 1; i < kunciSumber.length; i++) {
    var k = kunciSumber[i];
    pipeline.push({
      $unionWith: { coll: mapping.sumber[k].koleksi, pipeline: bangunPipelineSumber(k, mapping.sumber[k], { filter: filterLogis }) },
    });
  }
  pipeline.push({
    $addFields: {
      asal: { $ifNull: ['$asal', '$sumber'] },
      qtyBertanda: {
        $switch: {
          branches: [
            { case: { $eq: ['$arah', 'IN'] }, then: { $ifNull: ['$qty', 0] } },
            { case: { $eq: ['$arah', 'OUT'] }, then: { $multiply: [{ $ifNull: ['$qty', 0] }, -1] } },
          ],
          default: 0,
        },
      },
      urutArah: { $cond: [{ $eq: ['$arah', 'IN'] }, 0, 1] },
    },
  });
  return { koleksi: mapping.sumber[pertama].koleksi, pipeline: pipeline };
}

/** Tahap agregasi rekap: jumlah qty per kode x satuan x asal x arah x bucket waktu */
function tahapRekap(rentang, cutoff) {
  var kondisiCutoff = cutoff ? { $and: [{ $eq: ['$tanggalTipe', 'date'] }, { $lt: ['$tanggal', cutoff] }] } : false;
  return [
    {
      $addFields: {
        __bucket: {
          $cond: [
            { $eq: ['$tanggalTipe', 'date'] },
            {
              $switch: {
                branches: [
                  { case: { $lt: ['$tanggal', rentang.gte] }, then: 'AWAL' },
                  { case: { $lt: ['$tanggal', rentang.lt] }, then: 'PERIODE' },
                ],
                default: 'SESUDAH',
              },
            },
            'TANPA_TANGGAL',
          ],
        },
      },
    },
    {
      $group: {
        _id: { kode: '$kodeBarang', satuan: '$satuan', asal: '$asal', arah: '$arah', bucket: '$__bucket' },
        qty: { $sum: { $ifNull: ['$qty', 0] } },
        dok: { $sum: 1 },
        qtyKosong: { $sum: { $cond: [{ $eq: ['$qty', null] }, 1, 0] } },
        sebelumCutoff: { $sum: { $cond: [kondisiCutoff, 1, 0] } },
      },
    },
  ];
}

/**
 * Tahap agregasi saldo berjalan per kode ($setWindowFields, MongoDB 5.0+).
 * Hasil hanya untuk kode yang saldonya pernah minus DI DALAM periode:
 *   { _id: kode, tanggal, saldo, asal, arah, qty, docId, idAsal } = baris pertama yang membuat minus
 *   + saldoMin, barisMinus
 */
function tahapMinus(rentang) {
  return [
    { $match: { tanggalTipe: 'date', tanggal: { $lt: rentang.lt } } },
    {
      $setWindowFields: {
        partitionBy: '$kodeBarang',
        sortBy: { tanggal: 1, urutArah: 1, docId: 1 },
        output: { __saldo: { $sum: '$qtyBertanda', window: { documents: ['unbounded', 'current'] } } },
      },
    },
    { $match: { tanggal: { $gte: rentang.gte }, __saldo: { $lt: -EPS_MUTASI } } },
    { $sort: { kodeBarang: 1, tanggal: 1, urutArah: 1, docId: 1 } },
    {
      $group: {
        _id: '$kodeBarang',
        tanggal: { $first: '$tanggal' },
        saldo: { $first: '$__saldo' },
        asal: { $first: '$asal' },
        arah: { $first: '$arah' },
        qty: { $first: '$qty' },
        docId: { $first: '$docId' },
        idAsal: { $first: '$idAsal' },
        saldoMin: { $min: '$__saldo' },
        barisMinus: { $sum: 1 },
      },
    },
  ];
}

function _teksKunci(v) {
  return v === null || v === undefined ? '(kosong)' : String(v);
}

/** Olah hasil tahapRekap jadi satu objek per kode barang */
function pivotRekap(baris) {
  var perKode = {};
  var urutan = [];
  for (var i = 0; i < baris.length; i++) {
    var b = baris[i];
    var id = b._id || {};
    var kode = id.kode === undefined ? null : id.kode;
    var kunci = _teksKunci(kode);
    var r = perKode[kunci];
    if (!r) {
      r = {
        kodeBarang: kode, satuan: {}, awal: 0, masuk: 0, keluar: 0, perAsal: {},
        dokAwal: 0, dokPeriode: 0, dokSesudah: 0, tanpaTanggal: 0, arahTidakDikenal: 0, qtyKosong: 0, sebelumCutoff: 0,
      };
      perKode[kunci] = r;
      urutan.push(kunci);
    }
    var satuan = _teksKunci(id.satuan);
    r.satuan[satuan] = (r.satuan[satuan] || 0) + b.dok;
    r.qtyKosong += b.qtyKosong || 0;
    r.sebelumCutoff += b.sebelumCutoff || 0;
    if (id.bucket === 'TANPA_TANGGAL') {
      r.tanpaTanggal += b.dok;
      continue;
    }
    if (id.arah !== 'IN' && id.arah !== 'OUT') {
      r.arahTidakDikenal += b.dok;
      continue;
    }
    var masuk = id.arah === 'IN';
    if (id.bucket === 'AWAL') {
      r.awal += masuk ? b.qty : -b.qty;
      r.dokAwal += b.dok;
    } else if (id.bucket === 'PERIODE') {
      r.dokPeriode += b.dok;
      if (masuk) r.masuk += b.qty;
      else r.keluar += b.qty;
      var asal = _teksKunci(id.asal);
      var pa = r.perAsal[asal] || (r.perAsal[asal] = { masuk: 0, keluar: 0, dok: 0 });
      if (masuk) pa.masuk += b.qty;
      else pa.keluar += b.qty;
      pa.dok += b.dok;
    } else {
      r.dokSesudah += b.dok;
    }
  }
  var hasil = [];
  urutan.sort();
  for (var u = 0; u < urutan.length; u++) {
    var x = perKode[urutan[u]];
    x.awal = bulatkan(x.awal);
    x.masuk = bulatkan(x.masuk);
    x.keluar = bulatkan(x.keluar);
    x.akhir = bulatkan(x.awal + x.masuk - x.keluar);
    for (var a in x.perAsal) {
      x.perAsal[a].masuk = bulatkan(x.perAsal[a].masuk);
      x.perAsal[a].keluar = bulatkan(x.perAsal[a].keluar);
    }
    hasil.push(x);
  }
  return hasil;
}

/**
 * Tanda masalah untuk satu baris rekap.
 *   info: { master: objek|null, cekMaster: bool, minus: hasil tahapMinus|null }
 */
function tandaiRekap(r, info) {
  var tanda = [];
  if (r.akhir < -EPS_MUTASI) tanda.push('MINUS');
  if (r.awal < -EPS_MUTASI) tanda.push('AWAL_MINUS');
  if (info.minus && r.akhir >= -EPS_MUTASI) tanda.push('PERNAH_MINUS');
  if (info.cekMaster && !info.master) tanda.push('TIDAK_DI_MASTER');
  if (Object.keys(r.satuan).length > 1) tanda.push('SATUAN_CAMPUR');
  if (r.sebelumCutoff > 0) tanda.push('SEBELUM_CUTOFF');
  if (r.arahTidakDikenal > 0) tanda.push('ARAH_TIDAK_DIKENAL');
  if (r.qtyKosong > 0) tanda.push('QTY_KOSONG');
  if (r.tanpaTanggal > 0) tanda.push('TANPA_TANGGAL');
  return tanda;
}

/** Bobot urut: kode dengan tanda paling berat tampil duluan */
function bobotTanda(tanda) {
  var bobot = URUTAN_TANDA.length + 1;
  for (var i = 0; i < tanda.length; i++) {
    var p = URUTAN_TANDA.indexOf(tanda[i]);
    if (p >= 0 && p < bobot) bobot = p;
  }
  return bobot;
}

/** Nilai id (ObjectId / string hex) -> string hex huruf kecil, atau null */
function kunciIdHex(v) {
  if (v && typeof v === 'object' && (v._bsontype === 'ObjectId' || v._bsontype === 'ObjectID')) return v.toHexString().toLowerCase();
  if (typeof v === 'string' && POLA_HEX24.test(v)) return v.toLowerCase();
  return null;
}

/**
 * Bandingkan baris ledger dengan dokumen sumber yang dirujuk (keduanya sudah dinormalisasi).
 * Hasil: daftar kode temuan ([] = cocok).
 */
function bandingkanDenganSumber(baris, sumberDoc, tz) {
  if (!sumberDoc) return ['SUMBER_HILANG'];
  var hasil = [];
  if (sumberDoc.dihapus === true) hasil.push('SUMBER_DIHAPUS');
  if (typeof baris.qty === 'number' && typeof sumberDoc.qty === 'number') {
    if (Math.abs(baris.qty - sumberDoc.qty) > EPS_MUTASI) hasil.push('QTY_BEDA');
  } else if (baris.qty !== sumberDoc.qty) {
    hasil.push('QTY_BEDA');
  }
  if (baris.kodeBarang !== sumberDoc.kodeBarang) hasil.push('KODE_BEDA');
  if ((sumberDoc.arah === 'IN' || sumberDoc.arah === 'OUT') && sumberDoc.arah !== baris.arah) hasil.push('ARAH_BEDA');
  var tglA = baris.tanggal instanceof Date ? formatLokal(baris.tanggal, tz, false) : null;
  var tglB = sumberDoc.tanggal instanceof Date ? formatLokal(sumberDoc.tanggal, tz, false) : null;
  if (tglA !== tglB) hasil.push('TANGGAL_BEDA');
  if (baris.satuan !== null && baris.satuan !== undefined && sumberDoc.satuan !== null && sumberDoc.satuan !== undefined &&
      String(baris.satuan).trim() !== String(sumberDoc.satuan).trim()) {
    hasil.push('SATUAN_BEDA');
  }
  return hasil;
}

/** Nama sumber tujuan rujukan untuk satu baris (memakai MAPPING.sumber[baris.sumber].rujukan) */
function tujuanRujukan(mapping, baris) {
  var s = mapping.sumber[baris.sumber];
  if (!s || !s.rujukan) return null;
  return sumberRujukan(s, baris.asal, baris.arah);
}

// #region node-only
module.exports = {
  EPS_MUTASI: EPS_MUTASI,
  bulatkan: bulatkan,
  sumberDihitung: sumberDihitung,
  pipelineGabungan: pipelineGabungan,
  tahapRekap: tahapRekap,
  tahapMinus: tahapMinus,
  pivotRekap: pivotRekap,
  tandaiRekap: tandaiRekap,
  bobotTanda: bobotTanda,
  kunciIdHex: kunciIdHex,
  bandingkanDenganSumber: bandingkanDenganSumber,
  tujuanRujukan: tujuanRujukan,
};
// #endregion
