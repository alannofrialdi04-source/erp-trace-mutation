/**
 * @nama 00-peta-data
 * @judul Peta data: distribusi nilai kunci (status, arah, proses, satuan) dan relasi id antar koleksi
 * @mapping tidak
 */

// #region config
var CONFIG = {
  // Filter companyCode untuk distribusi & sampel relasi. null = semua company.
  COMPANY_CODE: 'WAG',

  // DISTRIBUSI: jumlah dokumen per kombinasi nilai (dihitung dari SELURUH koleksi, bukan sampel)
  //   koleksi : nama koleksi
  //   grup    : daftar field, atau { label, expr } untuk ekspresi agregasi MongoDB
  //   jumlah  : (opsional) field qty yang dijumlahkan per kombinasi
  //   tanggal : (opsional) field tanggal -> tanggal min/max per kombinasi (WIB)
  DISTRIBUSI: [
    { koleksi: 'tbl_stok', grup: ['asal', 'jenis', 'namaProses', 'infoProses'], jumlah: 'qty', tanggal: 'tanggal' },
    { koleksi: 'tbl_stok', grup: ['asal', { label: 'punya _class', expr: { $ne: [{ $type: '$_class' }, 'missing'] } }] },
    { koleksi: 'tbl_barang', grup: ['jenisBc'] },
    { koleksi: 'tbl_barangmasukdetail', grup: ['idDokumen', 'jenisBc', 'isDeleted', 'isReceiv'], jumlah: 'qty', tanggal: 'tglPenerimaan' },
    {
      koleksi: 'tbl_barangmasukdetail',
      grup: [
        { label: 'qty = qtyWh', expr: { $eq: ['$qty', '$qtyWh'] } },
        { label: 'satuan = satuanWh', expr: { $eq: ['$satuan', '$satuanWh'] } },
      ],
    },
    { koleksi: 'tbl_incomingdetail', grup: ['idDokumen', 'jenisBc', 'isDeleted', 'isReceiv'], jumlah: 'qtyWh', tanggal: 'tglMasuk' },
    {
      koleksi: 'tbl_incomingdetail',
      grup: [
        { label: 'qty = qtyWh', expr: { $eq: ['$qty', '$qtyWh'] } },
        { label: 'satuan = satuanWh', expr: { $eq: ['$satuan', '$satuanWh'] } },
        { label: 'qtyWh = qtyInputWh', expr: { $eq: ['$qtyWh', '$qtyInputWh'] } },
      ],
    },
    { koleksi: 'tbl_materialkeluardetail', grup: ['approveStatus', 'isApprove', 'isDeleted', 'isPenyesuaian', 'isManual'], jumlah: 'qtyKeluarOk', tanggal: 'tglKeluar' },
    {
      koleksi: 'tbl_materialkeluardetail',
      grup: [
        { label: 'qtyKeluar = qtyKeluarOk', expr: { $eq: ['$qtyKeluar', '$qtyKeluarOk'] } },
        { label: 'qtyKeluarOk = qtyProd', expr: { $eq: ['$qtyKeluarOk', '$qtyProd'] } },
        { label: 'satuan = satuanKeluarOk', expr: { $eq: ['$satuan', '$satuanKeluarOk'] } },
        { label: 'kodeBarang = kodeMaterial', expr: { $eq: ['$kodeBarang', '$kodeMaterial'] } },
      ],
    },
    { koleksi: 'tbl_deliverydetail', grup: ['idDokumen', 'jenisBc', 'isDeleted', 'isWarning'], jumlah: 'jmlKeluarOk', tanggal: 'tglKeluar' },
    {
      koleksi: 'tbl_deliverydetail',
      grup: [
        { label: 'jmlKeluar = jmlKeluarOk', expr: { $eq: ['$jmlKeluar', '$jmlKeluarOk'] } },
        { label: 'satuan = satuanKeluarOk', expr: { $eq: ['$satuan', '$satuanKeluarOk'] } },
      ],
    },
    { koleksi: 'tbl_productiondetail', grup: ['kodeProses', 'info', 'isDeleted'], jumlah: 'qty', tanggal: 'tanggal' },
    { koleksi: 'tbl_receivingproduction', grup: ['kodeProsesAsal', 'kodeProses', 'approveStatus', 'isDeleted'], jumlah: 'qty', tanggal: 'tanggal' },
    { koleksi: 'tbl_transferproduction', grup: ['kodeProses', 'kodeProsesTujuan', 'approveStatus', 'isComplete', 'isDeleted'], jumlah: 'qty', tanggal: 'tanggal' },
    { koleksi: 'tbl_requestdetail', grup: ['tujuan', 'approveStatus', 'isComplete', 'isDeleted'], jumlah: 'qty', tanggal: 'tglRequest' },
    {
      koleksi: 'tbl_penyesuaiandetail',
      grup: [
        'noReg',
        'jenisBc',
        {
          label: 'tanda qtySesuai',
          expr: {
            $switch: {
              branches: [
                { case: { $not: [{ $in: [{ $type: '$qtySesuai' }, ['double', 'int', 'long', 'decimal']] }] }, then: 'bukan angka' },
                { case: { $lt: ['$qtySesuai', 0] }, then: 'negatif' },
                { case: { $eq: ['$qtySesuai', 0] }, then: 'nol' },
              ],
              default: 'positif',
            },
          },
        },
      ],
      jumlah: 'qtySesuai',
      tanggal: 'tanggal',
    },
    { koleksi: 'tbl_monsusdetail', grup: ['noReg', 'noBap'], jumlah: 'qty', tanggal: 'tanggal' },
    { koleksi: 'tbl_stokopnamedetail', grup: ['noReg', 'noBap'], jumlah: 'qtyOpname', tanggal: 'tglOpname' },
    { koleksi: 'exim_scrapdetail', grup: ['isDeleted', 'satuan'], jumlah: 'qty', tanggal: 'tanggal' },
    { koleksi: 'tbl_deadstokdetail', grup: ['idDokumen', 'satuan'], jumlah: 'qty', tanggal: 'tanggal' },
  ],

  // Maksimal kombinasi yang ditampilkan per distribusi
  TOP: 25,

  // RELASI: field berisi id -> dicari menunjuk ke koleksi mana (dicocokkan ke _id)
  //   perNilai : (opsional) sampel dipisah per nilai field ini, mis. tbl_stok per 'asal'
  RELASI: [
    { koleksi: 'tbl_incomingdetail', field: 'idAsal' },
    { koleksi: 'tbl_incomingheader', field: 'idHeaderDokumen' },
    { koleksi: 'tbl_materialkeluardetail', field: 'idAsal' },
    { koleksi: 'tbl_materialkeluardetail', field: 'idRequest' },
    { koleksi: 'tbl_materialkeluardetail', field: 'idPenyesuaian' },
    { koleksi: 'tbl_receivingproduction', field: 'idAsal' },
    { koleksi: 'tbl_receivingproduction', field: 'idBm' },
    { koleksi: 'tbl_productiondetail', field: 'idAsal', perNilai: 'info' },
    { koleksi: 'tbl_productiondetail', field: 'idAsalIncoming' },
    { koleksi: 'tbl_productiondetail', field: 'idAsalProduksi' },
    { koleksi: 'tbl_transferproduction', field: 'idAsal' },
    { koleksi: 'tbl_transferproduction', field: 'idAsalIncoming' },
    { koleksi: 'tbl_requestdetail', field: 'idAsal' },
    { koleksi: 'tbl_deliverydetail', field: 'idAsal' },
    { koleksi: 'tbl_deliverydetail', field: 'idWoDetail' },
    { koleksi: 'tbl_deadstokdetail', field: 'idAsalIncoming' },
    { koleksi: 'tbl_stok', field: 'idAsal', perNilai: 'asal' },
  ],

  // Jumlah nilai id yang diambil per relasi (maks 1000)
  SAMPEL_RELASI: 200,

  // Koleksi target pencarian _id. [] = semua koleksi di database (pakai index _id, ringan).
  TARGET_RELASI: [],

  // Array id tertanam yang ikut dicek. Memindai koleksi, jadi dibatasi ke daftar ini.
  TARGET_TERTANAM: [
    { koleksi: 'tbl_barangmasukheader', path: 'listDetail._id' },
    { koleksi: 'tbl_incomingheader', path: 'listDetail._id' },
    { koleksi: 'tbl_materialkeluarheader', path: 'listDetail._id' },
    { koleksi: 'tbl_requestheader', path: 'listDetail._id' },
    { koleksi: 'tbl_receivingproductionheader', path: 'listDetail._id' },
    { koleksi: 'tbl_productionheader', path: 'listDetail._id' },
    { koleksi: 'tbl_productiondetail', path: 'listHasil._id' },
    { koleksi: 'tbl_deliveryheader', path: 'listDetail._id' },
  ],

  // Database: null = database aktif di koneksi
  DB: null,

  // 'teks' | 'json'
  FORMAT: 'teks',
};
// #endregion

var PETA_BATAS_SAMPEL_RELASI = 1000;
var PETA_BATAS_NILAI_PER = 20;
var PETA_TIPE_ID = ['ObjectId', 'ObjectID'];

function _petaValidasiConfig(config) {
  if (!Array.isArray(config.DISTRIBUSI) || !Array.isArray(config.RELASI)) {
    throw new Error('CONFIG.DISTRIBUSI dan CONFIG.RELASI harus berupa array');
  }
  var i;
  for (i = 0; i < config.DISTRIBUSI.length; i++) {
    var d = config.DISTRIBUSI[i];
    if (!d || typeof d.koleksi !== 'string' || !Array.isArray(d.grup) || !d.grup.length) {
      throw new Error('CONFIG.DISTRIBUSI[' + i + '] wajib punya koleksi (teks) dan grup (array tidak kosong)');
    }
    for (var g = 0; g < d.grup.length; g++) {
      var item = d.grup[g];
      var valid = typeof item === 'string' ? item !== '' : item && typeof item.label === 'string' && item.expr !== undefined;
      if (!valid) throw new Error('CONFIG.DISTRIBUSI[' + i + '].grup[' + g + '] harus nama field atau { label, expr }');
    }
  }
  for (i = 0; i < config.RELASI.length; i++) {
    var r = config.RELASI[i];
    if (!r || typeof r.koleksi !== 'string' || typeof r.field !== 'string') {
      throw new Error('CONFIG.RELASI[' + i + '] wajib punya koleksi dan field (teks)');
    }
  }
  var n = Number(config.SAMPEL_RELASI);
  if (!isFinite(n) || n < 1 || Math.floor(n) !== n || n > PETA_BATAS_SAMPEL_RELASI) {
    throw new Error('CONFIG.SAMPEL_RELASI harus bilangan bulat 1-' + PETA_BATAS_SAMPEL_RELASI);
  }
  var top = Number(config.TOP);
  if (!isFinite(top) || top < 1) throw new Error('CONFIG.TOP harus >= 1');
}

function _petaMatchCompany(config) {
  return config.COMPANY_CODE ? { companyCode: config.COMPANY_CODE } : {};
}

// ---------------------------------------------------------------- distribusi

function _petaDistribusi(d, def, config, semuaKoleksi) {
  var label = [];
  var idGrup = {};
  var i;
  for (i = 0; i < def.grup.length; i++) {
    var g = def.grup[i];
    label.push(typeof g === 'string' ? g : g.label);
    // $ifNull: field yang tidak ada (missing) disatukan dengan null, supaya tidak jadi dua grup "(kosong)"
    idGrup['g' + i] = typeof g === 'string' ? { $ifNull: ['$' + g, null] } : g.expr;
  }
  var hasil = { koleksi: def.koleksi, grup: label, jumlahField: def.jumlah || null, tanggalField: def.tanggal || null };
  if (semuaKoleksi.indexOf(def.koleksi) < 0) {
    hasil.ada = false;
    hasil.kandidat = kandidatNama(def.koleksi, semuaKoleksi, 5);
    return hasil;
  }
  var tahapGroup = { _id: idGrup, dok: { $sum: 1 } };
  if (def.jumlah) {
    tahapGroup.total = { $sum: { $convert: { input: '$' + def.jumlah, to: 'double', onError: 0, onNull: 0 } } };
  }
  if (def.tanggal) {
    tahapGroup.tglMin = { $min: '$' + def.tanggal };
    tahapGroup.tglMax = { $max: '$' + def.tanggal };
  }
  var pipeline = [];
  var match = _petaMatchCompany(config);
  if (Object.keys(match).length) pipeline.push({ $match: match });
  pipeline.push({ $group: tahapGroup });
  pipeline.push({ $sort: { dok: -1 } });
  var baris = jalankanAgregasi(d, def.koleksi, pipeline);

  var totalDok = 0;
  var kombinasi = [];
  for (i = 0; i < baris.length; i++) {
    totalDok += baris[i].dok;
    if (kombinasi.length >= config.TOP) continue;
    var nilai = [];
    for (var j = 0; j < label.length; j++) {
      var v = baris[i]._id ? baris[i]._id['g' + j] : undefined;
      nilai.push(v === undefined ? null : v);
    }
    var k = { nilai: nilai, dok: baris[i].dok };
    if (def.jumlah) k.total = baris[i].total;
    if (def.tanggal) {
      k.tglMin = baris[i].tglMin === undefined ? null : baris[i].tglMin;
      k.tglMax = baris[i].tglMax === undefined ? null : baris[i].tglMax;
    }
    kombinasi.push(k);
  }
  hasil.ada = true;
  hasil.totalDok = totalDok;
  hasil.jumlahKombinasi = baris.length;
  hasil.kombinasi = kombinasi;
  return hasil;
}

// ------------------------------------------------------------------- relasi

function _petaKunciId(v) {
  if (v && typeof v === 'object' && PETA_TIPE_ID.indexOf(v._bsontype) >= 0) return v.toHexString().toLowerCase();
  if (typeof v === 'string') return POLA_HEX24.test(v) ? v.toLowerCase() : 'str:' + v;
  return 'lain:' + String(v);
}

function _petaNilaiPer(d, rel, config) {
  var pipeline = [];
  var match = _petaMatchCompany(config);
  if (Object.keys(match).length) pipeline.push({ $match: match });
  pipeline.push({ $group: { _id: '$' + rel.perNilai, n: { $sum: 1 } } });
  pipeline.push({ $sort: { n: -1 } });
  pipeline.push({ $limit: PETA_BATAS_NILAI_PER });
  var baris = jalankanAgregasi(d, rel.koleksi, pipeline);
  var hasil = [];
  for (var i = 0; i < baris.length; i++) hasil.push(baris[i]._id === undefined ? null : baris[i]._id);
  return hasil;
}

function _petaSampelId(d, rel, adaPer, nilaiPer, config) {
  var match = _petaMatchCompany(config);
  if (adaPer) match[rel.perNilai] = nilaiPer;
  match[rel.field] = { $nin: [null, ''] };
  var baris = jalankanAgregasi(d, rel.koleksi, [
    { $match: match },
    { $sample: { size: Number(config.SAMPEL_RELASI) } },
    { $project: { _id: 0, v: '$' + rel.field } },
  ]);
  var kunci = {};
  var daftar = [];
  for (var i = 0; i < baris.length; i++) {
    var isi = Array.isArray(baris[i].v) ? baris[i].v : [baris[i].v];
    for (var j = 0; j < isi.length; j++) {
      if (isi[j] === null || isi[j] === undefined || isi[j] === '') continue;
      var k = _petaKunciId(isi[j]);
      if (!kunci[k]) {
        kunci[k] = true;
        daftar.push(k);
      }
    }
  }
  return daftar;
}

/** Kunci id -> nilai yang dipakai di query ($in): ObjectId dan string hex */
function _petaNilaiQuery(semuaKunci) {
  var hasil = [];
  for (var i = 0; i < semuaKunci.length; i++) {
    var k = semuaKunci[i];
    if (k.indexOf('str:') === 0) hasil.push(k.slice(4));
    else if (k.indexOf('lain:') === 0) continue;
    else {
      hasil.push(ObjectId(k));
      hasil.push(k);
    }
  }
  return hasil;
}

function _petaCariTopLevel(d, target, nilaiQuery) {
  var ketemu = {};
  if (!nilaiQuery.length) return ketemu;
  var dok = d.getCollection(target).find({ _id: { $in: nilaiQuery } }, { _id: 1 }).toArray();
  for (var i = 0; i < dok.length; i++) ketemu[_petaKunciId(dok[i]._id)] = true;
  return ketemu;
}

function _petaCariTertanam(d, def, nilaiQuery) {
  var ketemu = {};
  if (!nilaiQuery.length) return ketemu;
  var cocok = {};
  cocok[def.path] = { $in: nilaiQuery };
  var baris = jalankanAgregasi(d, def.koleksi, [
    { $match: cocok },
    { $project: { _id: 0, v: '$' + def.path } },
    { $unwind: '$v' },
    { $match: { v: { $in: nilaiQuery } } },
    { $group: { _id: '$v' } },
  ]);
  for (var i = 0; i < baris.length; i++) ketemu[_petaKunciId(baris[i]._id)] = true;
  return ketemu;
}

function _petaRelasi(d, config, semuaKoleksi, catatan) {
  var link = [];
  var semuaKunci = {};
  var i;
  var j;
  for (i = 0; i < config.RELASI.length; i++) {
    var rel = config.RELASI[i];
    if (semuaKoleksi.indexOf(rel.koleksi) < 0) {
      link.push({ koleksi: rel.koleksi, field: rel.field, perNilai: null, ada: false, kandidat: kandidatNama(rel.koleksi, semuaKoleksi, 5) });
      continue;
    }
    var daftarPer = rel.perNilai ? _petaNilaiPer(d, rel, config) : [undefined];
    for (j = 0; j < daftarPer.length; j++) {
      var kunci = _petaSampelId(d, rel, !!rel.perNilai, daftarPer[j], config);
      var hex = 0;
      for (var k = 0; k < kunci.length; k++) {
        semuaKunci[kunci[k]] = true;
        if (kunci[k].indexOf(':') < 0) hex++;
      }
      link.push({
        koleksi: rel.koleksi,
        field: rel.field,
        perNilai: rel.perNilai ? { field: rel.perNilai, nilai: daftarPer[j] } : null,
        ada: true,
        kunci: kunci,
        hex24: hex,
      });
    }
  }

  var nilaiQuery = _petaNilaiQuery(Object.keys(semuaKunci));
  var target = config.TARGET_RELASI && config.TARGET_RELASI.length ? config.TARGET_RELASI : semuaKoleksi;
  var temuan = [];
  for (i = 0; i < target.length; i++) {
    if (semuaKoleksi.indexOf(target[i]) < 0) {
      catatan.push('Target relasi "' + target[i] + '" tidak ditemukan, dilewati.');
      continue;
    }
    temuan.push({ label: target[i], ketemu: _petaCariTopLevel(d, target[i], nilaiQuery) });
  }
  var tertanam = config.TARGET_TERTANAM || [];
  for (i = 0; i < tertanam.length; i++) {
    if (semuaKoleksi.indexOf(tertanam[i].koleksi) < 0) {
      catatan.push('Target tertanam "' + tertanam[i].koleksi + '" tidak ditemukan, dilewati.');
      continue;
    }
    temuan.push({
      label: tertanam[i].koleksi + '.' + tertanam[i].path.replace(/\._id$/, ''),
      ketemu: _petaCariTertanam(d, tertanam[i], nilaiQuery),
    });
  }

  var hasil = [];
  for (i = 0; i < link.length; i++) {
    var l = link[i];
    if (!l.ada) {
      hasil.push(l);
      continue;
    }
    var ditemukan = [];
    var tidak = 0;
    for (j = 0; j < temuan.length; j++) {
      var n = 0;
      for (var m = 0; m < l.kunci.length; m++) if (temuan[j].ketemu[l.kunci[m]]) n++;
      if (n > 0) ditemukan.push({ target: temuan[j].label, jumlah: n });
    }
    for (j = 0; j < l.kunci.length; j++) {
      var adaDiMana = false;
      for (var t = 0; t < temuan.length && !adaDiMana; t++) if (temuan[t].ketemu[l.kunci[j]]) adaDiMana = true;
      if (!adaDiMana) tidak++;
    }
    ditemukan.sort(function (a, b) { return b.jumlah - a.jumlah || (a.target < b.target ? -1 : 1); });
    hasil.push({
      koleksi: l.koleksi,
      field: l.field,
      perNilai: l.perNilai,
      ada: true,
      sampel: l.kunci.length,
      hex24: l.hex24,
      ditemukan: ditemukan,
      tidakDitemukan: tidak,
    });
  }
  return { link: hasil, jumlahTarget: temuan.length };
}

// ------------------------------------------------------------------ jalankan

function jalankan(config, mapping, ctx) {
  _petaValidasiConfig(config);
  var infos = ctx.db.getCollectionInfos({ type: 'collection' });
  var semuaKoleksi = [];
  for (var i = 0; i < infos.length; i++) {
    if (infos[i].name.indexOf('system.') !== 0) semuaKoleksi.push(infos[i].name);
  }
  var distribusi = [];
  for (var j = 0; j < config.DISTRIBUSI.length; j++) {
    distribusi.push(_petaDistribusi(ctx.db, config.DISTRIBUSI[j], config, semuaKoleksi));
  }
  var catatan = [];
  var relasi = _petaRelasi(ctx.db, config, semuaKoleksi, catatan);
  return {
    companyCode: config.COMPANY_CODE || null,
    sampelRelasi: Number(config.SAMPEL_RELASI),
    distribusi: distribusi,
    relasi: relasi.link,
    jumlahTargetRelasi: relasi.jumlahTarget,
    catatan: catatan,
  };
}

// -------------------------------------------------------------------- render

function _petaTeksNilai(v, tz) {
  if (v === null || v === undefined) return '(kosong)';
  if (v instanceof Date) return formatLokal(v, tz, false);
  if (typeof v === 'string') return v === '' || punyaSpasiTepi(v) ? JSON.stringify(v) : v;
  if (typeof v === 'number') return fmtAngka(v, 'auto');
  var n = angkaDariNilai(v);
  if (n !== null) return fmtAngka(n, 'auto');
  return String(v);
}

function _petaGaris(judul) {
  return '--- ' + judul + ' ' + new Array(Math.max(3, 74 - judul.length)).join('-');
}

function render(hasil, ctx) {
  var baris = [];
  var i;
  baris.push('Filter companyCode: ' + (hasil.companyCode ? JSON.stringify(hasil.companyCode) : '(semua)'));
  baris.push('');
  baris.push('############################## DISTRIBUSI ##############################');
  for (i = 0; i < hasil.distribusi.length; i++) {
    var d = hasil.distribusi[i];
    baris.push('');
    baris.push(_petaGaris(d.koleksi + ': ' + d.grup.join(' x ')));
    if (!d.ada) {
      baris.push('TIDAK DITEMUKAN.' + (d.kandidat.length ? ' Mungkin maksudnya: ' + d.kandidat.join(', ') : ''));
      continue;
    }
    baris.push(fmtAngka(d.totalDok) + ' dokumen, ' + fmtAngka(d.jumlahKombinasi) + ' kombinasi' +
      (d.jumlahKombinasi > d.kombinasi.length ? ' (ditampilkan ' + d.kombinasi.length + ' teratas)' : ''));
    if (!d.kombinasi.length) continue;
    var kolom = [];
    var j;
    for (j = 0; j < d.grup.length; j++) kolom.push({ judul: d.grup[j], kunci: 'g' + j, maks: 40 });
    kolom.push({ judul: 'DOK', kunci: 'dok', kanan: true });
    if (d.jumlahField) kolom.push({ judul: 'TOTAL ' + d.jumlahField, kunci: 'total', kanan: true });
    if (d.tanggalField) kolom.push({ judul: d.tanggalField + ' (min s/d max)', kunci: 'tgl' });
    var data = [];
    for (j = 0; j < d.kombinasi.length; j++) {
      var k = d.kombinasi[j];
      var row = { dok: fmtAngka(k.dok) };
      for (var g = 0; g < k.nilai.length; g++) row['g' + g] = _petaTeksNilai(k.nilai[g], ctx.tz);
      if (d.jumlahField) row.total = fmtAngka(k.total, 'auto');
      if (d.tanggalField) row.tgl = _petaTeksNilai(k.tglMin, ctx.tz) + ' s/d ' + _petaTeksNilai(k.tglMax, ctx.tz);
      data.push(row);
    }
    baris = baris.concat(formatTabel(kolom, data));
  }

  baris.push('');
  baris.push('################################ RELASI ################################');
  baris.push('Id dicocokkan ke _id di ' + hasil.jumlahTargetRelasi + ' target (koleksi + array tertanam). Sampel maks ' +
    hasil.sampelRelasi + ' nilai per relasi.');
  for (i = 0; i < hasil.relasi.length; i++) {
    var r = hasil.relasi[i];
    var judul = r.koleksi + '.' + r.field + (r.perNilai ? ' [' + r.perNilai.field + ' = ' + _petaTeksNilai(r.perNilai.nilai, ctx.tz) + ']' : '');
    baris.push('');
    if (!r.ada) {
      baris.push(judul + ' -> KOLEKSI TIDAK DITEMUKAN.' + (r.kandidat.length ? ' Mungkin maksudnya: ' + r.kandidat.join(', ') : ''));
      continue;
    }
    baris.push(judul + ' | sampel ' + r.sampel + ' nilai' + (r.sampel ? ' (format hex ObjectId ' + fmtPersen(r.hex24, r.sampel) + ')' : ''));
    if (!r.sampel) {
      baris.push('    (field kosong di semua dokumen)');
      continue;
    }
    var isi = [];
    for (var t = 0; t < r.ditemukan.length; t++) {
      isi.push({ target: r.ditemukan[t].target, n: r.ditemukan[t].jumlah, p: fmtPersen(r.ditemukan[t].jumlah, r.sampel) });
    }
    if (r.tidakDitemukan) isi.push({ target: 'tidak ditemukan di mana pun', n: r.tidakDitemukan, p: fmtPersen(r.tidakDitemukan, r.sampel) });
    var tabel = formatTabel([
      { judul: 'TARGET', kunci: 'target' },
      { judul: 'JUMLAH', kunci: 'n', kanan: true },
      { judul: '%', kunci: 'p' },
    ], isi);
    for (var x = 2; x < tabel.length; x++) baris.push('    ' + tabel[x]);
  }
  for (i = 0; i < hasil.catatan.length; i++) baris.push('Catatan: ' + hasil.catatan[i]);
  baris.push('');
  baris.push('Selesai. Nilai yang ditampilkan hanya nilai kategori (status, arah, proses, nomor registrasi), bukan data transaksi lengkap.');
  return baris;
}
