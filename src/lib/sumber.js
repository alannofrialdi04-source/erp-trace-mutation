/**
 * Pembangun pipeline agregasi yang mengubah dokumen transaksi dari koleksi mana pun
 * jadi satu bentuk "baris mutasi" yang seragam:
 *
 *   { sumber, koleksi, kategori, docId, tanggal, companyCode, kodeBarang, qty, arah,
 *     noTransaksi, idAsal, idDokumen, noAju, noReg, noUrut, jenisDokumen, satuan,
 *     gudang, createdAt,
 *     // kolom diagnosa:
 *     tanggalTipe, kodeBarangAsli, kodeBarangTipe, qtyAsli, qtyTipe, arahAsli,
 *     headerJumlah, linkTipe }
 *
 * Fungsi di file ini murni (hanya menyusun pipeline), tidak menjalankan query.
 */

// #region node-only
var _m = require('./mapping');
var FIELD_OPSIONAL = _m.FIELD_OPSIONAL;
var lokasiField = _m.lokasiField;
var normalKunciArah = _m.normalKunciArah;
// #endregion

var PREFIX_HEADER = '__h';
var TIPE_QTY_KONVERSI = ['double', 'int', 'long', 'decimal', 'string'];

function _pathFisik(sumber, logis) {
  var lok = lokasiField(sumber, logis);
  if (!lok) return null;
  return lok.lokasi === 'header' ? PREFIX_HEADER + '.' + lok.path : lok.path;
}

function _ekspresi(sumber, logis) {
  var p = _pathFisik(sumber, logis);
  return p === null ? null : '$' + p;
}

function _atauNull(expr) {
  return expr === null ? { $literal: null } : { $ifNull: [expr, null] };
}

function _gabungFilter(a, b) {
  var adaA = a && Object.keys(a).length > 0;
  var adaB = b && Object.keys(b).length > 0;
  if (adaA && adaB) return { $and: [a, b] };
  if (adaA) return a;
  if (adaB) return b;
  return null;
}

/**
 * Terjemahkan filter logis ke path fisik, dipisah per lokasi (detail / header).
 *   filterLogis: { companyCode, kodeBarang (teks | array), tanggal: { gte, lt } }
 */
function _filterPerLokasi(kunci, sumber, filterLogis) {
  var hasil = { detail: {}, header: {} };
  function taruh(logis, kondisi) {
    var lok = lokasiField(sumber, logis);
    if (!lok) throw new Error('Filter "' + logis + '" tidak bisa dipakai: field belum dipetakan di sumber "' + kunci + '"');
    if (lok.lokasi === 'header') hasil.header[PREFIX_HEADER + '.' + lok.path] = kondisi;
    else hasil.detail[lok.path] = kondisi;
  }
  if (filterLogis.companyCode !== undefined && filterLogis.companyCode !== null) {
    taruh('companyCode', filterLogis.companyCode);
  }
  if (filterLogis.kodeBarang !== undefined && filterLogis.kodeBarang !== null) {
    taruh('kodeBarang', Array.isArray(filterLogis.kodeBarang) ? { $in: filterLogis.kodeBarang } : filterLogis.kodeBarang);
  }
  if (filterLogis.tanggal) {
    var k = {};
    if (filterLogis.tanggal.gte) k.$gte = filterLogis.tanggal.gte;
    if (filterLogis.tanggal.lt) k.$lt = filterLogis.tanggal.lt;
    if (Object.keys(k).length) taruh('tanggal', k);
  }
  return hasil;
}

function _ekspresiArah(sumber) {
  var a = sumber.arah;
  if (a === 'IN' || a === 'OUT') return { expr: { $literal: a }, asli: { $literal: null } };
  if (a === 'TANDA_QTY') {
    return {
      expr: { $cond: [{ $eq: ['$__qty', null] }, 'TIDAK_DIKENAL', { $cond: [{ $lt: ['$__qty', 0] }, 'OUT', 'IN'] }] },
      asli: { $literal: null },
    };
  }
  var mentah = a.dari === 'header' ? '$' + PREFIX_HEADER + '.' + a.field : '$' + a.field;
  var normal = { $toUpper: { $trim: { input: { $convert: { input: mentah, to: 'string', onError: '', onNull: '' } } } } };
  var cabang = [];
  var kunci = Object.keys(a.nilai);
  for (var i = 0; i < kunci.length; i++) {
    cabang.push({ case: { $eq: [normal, normalKunciArah(kunci[i])] }, then: a.nilai[kunci[i]] });
  }
  return { expr: { $switch: { branches: cabang, default: 'TIDAK_DIKENAL' } }, asli: { $ifNull: [mentah, null] } };
}

/**
 * Susun pipeline untuk satu sumber.
 *   kunci  : nama sumber di MAPPING (mis. 'incoming')
 *   sumber : definisi sumber (MAPPING.sumber[kunci])
 *   opsi   : {
 *     filter : { companyCode, kodeBarang, tanggal: { gte, lt } }  (opsional)
 *     sampel : n  -> ambil n dokumen detail terbaru (urut _id menurun) SEBELUM lookup header
 *     matchAwal : filter MongoDB mentah yang ditambahkan di $match pertama (mis. { _id: { $in: [...] } })
 *     tanpaFilterSumber : true = abaikan sumber.filter (dipakai saat menelusuri dokumen
 *                         yang dirujuk ledger, supaya dokumen yang "seharusnya tersaring" tetap terlihat)
 *   }
 *
 * Catatan performa: filter yang field-nya ada di header diterapkan SETELAH $lookup.
 * Untuk koleksi besar, sertakan filter yang ada di detail (mis. kodeBarang).
 */
function bangunPipelineSumber(kunci, sumber, opsi) {
  opsi = opsi || {};
  var filter = _filterPerLokasi(kunci, sumber, opsi.filter || {});
  var pipeline = [];

  var filterTetap = opsi.tanpaFilterSumber ? null : sumber.filter;
  var matchDetail = _gabungFilter(_gabungFilter(opsi.matchAwal, filterTetap), filter.detail);
  if (matchDetail) pipeline.push({ $match: matchDetail });
  if (opsi.sampel) {
    pipeline.push({ $sort: { _id: -1 } });
    pipeline.push({ $limit: opsi.sampel });
  }

  var h = sumber.header;
  if (h) {
    var localField = h.localField;
    if (h.konversi) {
      pipeline.push({
        $addFields: {
          __link: {
            $convert: {
              input: '$' + h.localField,
              to: h.konversi === 'toObjectId' ? 'objectId' : 'string',
              onError: null,
              onNull: null,
            },
          },
        },
      });
      localField = '__link';
    }
    pipeline.push({ $lookup: { from: h.koleksi, localField: localField, foreignField: h.foreignField || '_id', as: PREFIX_HEADER } });
    pipeline.push({
      $addFields: {
        __hJumlah: { $size: '$' + PREFIX_HEADER },
        __h: { $arrayElemAt: ['$' + PREFIX_HEADER, 0] },
      },
    });
    var filterHeaderTetap = {};
    if (h.filter) {
      var kf = Object.keys(h.filter);
      for (var i = 0; i < kf.length; i++) filterHeaderTetap[PREFIX_HEADER + '.' + kf[i]] = h.filter[kf[i]];
    }
    var matchHeader = _gabungFilter(filterHeaderTetap, filter.header);
    if (matchHeader) pipeline.push({ $match: matchHeader });
  }

  var qtyMentah = _ekspresi(sumber, 'qty');
  pipeline.push({
    $addFields: {
      __qty: {
        $cond: [
          { $in: [{ $type: qtyMentah }, TIPE_QTY_KONVERSI] },
          { $convert: { input: qtyMentah, to: 'double', onError: null, onNull: null } },
          null,
        ],
      },
    },
  });

  var tanggal = _ekspresi(sumber, 'tanggal');
  var kode = _ekspresi(sumber, 'kodeBarang');
  var arah = _ekspresiArah(sumber);
  var proyeksi = {
    _id: 0,
    sumber: { $literal: kunci },
    koleksi: { $literal: sumber.koleksi },
    kategori: { $literal: sumber.kategori === undefined ? null : sumber.kategori },
    docId: '$_id',
    tanggal: _atauNull(tanggal),
    companyCode: _atauNull(_ekspresi(sumber, 'companyCode')),
    kodeBarang: { $cond: [{ $eq: [{ $type: kode }, 'string'] }, { $trim: { input: kode } }, { $ifNull: [kode, null] }] },
    qty: sumber.arah === 'TANDA_QTY' ? { $abs: '$__qty' } : '$__qty',
    arah: arah.expr,
    tanggalTipe: { $type: tanggal },
    kodeBarangAsli: _atauNull(kode),
    kodeBarangTipe: { $type: kode },
    qtyAsli: _atauNull(qtyMentah),
    qtyTipe: { $type: qtyMentah },
    arahAsli: arah.asli,
    headerJumlah: h ? '$__hJumlah' : { $literal: null },
    linkTipe: h ? { $type: '$' + h.localField } : { $literal: null },
  };
  for (var j = 0; j < FIELD_OPSIONAL.length; j++) {
    proyeksi[FIELD_OPSIONAL[j]] = _atauNull(_ekspresi(sumber, FIELD_OPSIONAL[j]));
  }
  pipeline.push({ $project: proyeksi });
  return pipeline;
}

/** Lokasi filter logis yang jatuh di header (dipakai untuk catatan di laporan) */
function filterDiHeader(sumber, filterLogis) {
  var hasil = [];
  var daftar = ['companyCode', 'kodeBarang', 'tanggal'];
  for (var i = 0; i < daftar.length; i++) {
    var f = daftar[i];
    if (filterLogis[f] === undefined || filterLogis[f] === null) continue;
    var lok = lokasiField(sumber, f);
    if (lok && lok.lokasi === 'header') hasil.push(f);
  }
  return hasil;
}

// #region node-only
module.exports = {
  PREFIX_HEADER: PREFIX_HEADER,
  bangunPipelineSumber: bangunPipelineSumber,
  filterDiHeader: filterDiHeader,
};
// #endregion
