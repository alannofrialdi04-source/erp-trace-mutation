/**
 * Lapisan shell (mongosh): eksekusi query read-only, override untuk test,
 * header laporan, dan output teks/JSON.
 *
 * Aturan:
 *   - Hanya find / aggregate / count. Tidak ada operasi tulis.
 *   - Panggilan shell API tidak diletakkan di dalam callback (map/forEach/sort)
 *     supaya aman dengan async rewriter mongosh.
 */

var PENANDA_JSON_AWAL = '__TRACE_JSON_BEGIN__';
var PENANDA_JSON_AKHIR = '__TRACE_JSON_END__';
var BATAS_SAMPEL = 5000;

function daftarNamaKoleksi(d) {
  return d.getCollectionNames();
}

function jalankanAgregasi(d, koleksi, pipeline) {
  return d.getCollection(koleksi).aggregate(pipeline, { allowDiskUse: true }).toArray();
}

function ambilSampel(d, koleksi, n, mode) {
  if (mode === 'acak') return d.getCollection(koleksi).aggregate([{ $sample: { size: n } }]).toArray();
  return d.getCollection(koleksi).find({}).sort({ _id: -1 }).limit(n).toArray();
}

function estimasiJumlahDokumen(d, koleksi) {
  try {
    return d.getCollection(koleksi).estimatedDocumentCount();
  } catch (e) {
    return null;
  }
}

function angkaSampel(nilai, nama) {
  var n = Number(nilai);
  if (!isFinite(n) || n < 1 || Math.floor(n) !== n) {
    throw new Error('CONFIG.' + nama + ' harus bilangan bulat >= 1 (sekarang: ' + JSON.stringify(nilai) + ')');
  }
  if (n > BATAS_SAMPEL) throw new Error('CONFIG.' + nama + ' maksimal ' + BATAS_SAMPEL + ' (sekarang: ' + n + ')');
  return n;
}

function _versiServer(d) {
  try {
    return d.version();
  } catch (e) {
    return null;
  }
}

function _overrideTrace() {
  if (typeof __TRACE_OVERRIDE__ !== 'undefined' && __TRACE_OVERRIDE__) return __TRACE_OVERRIDE__;
  return {};
}

function _headerTeks(meta, ctx) {
  var garis = new Array(79).join('=');
  var status = meta.statusMapping;
  var ketMapping = status === 'TERVERIFIKASI'
    ? 'TERVERIFIKASI'
    : (status || 'tanpa status') + ' (nama koleksi/field belum diverifikasi dengan data asli)';
  return [
    garis,
    ' ERP Trace Mutation | ' + meta.tool + ' | v' + meta.versi,
    ' ' + ctx.info.judul,
    ' DB      : ' + meta.db + (meta.server ? ' (MongoDB ' + meta.server + ')' : ''),
    ' Waktu   : ' + formatLokal(ctx.waktu, ctx.tz) + ' ' + labelZona(ctx.tz),
    ' Mapping : ' + ketMapping,
    garis,
  ];
}

/**
 * Titik masuk semua tool.
 *   info       : { nama, judul, versi }
 *   configFile : CONFIG dari file
 *   mappingFile: MAPPING dari file
 *   fnJalankan : function (config, mapping, ctx) -> hasil
 *   fnRender   : function (hasil, ctx, config) -> array baris teks
 */
function jalankanTool(info, configFile, mappingFile, fnJalankan, fnRender) {
  var ov = _overrideTrace();
  var config = Object.assign({}, configFile, ov.CONFIG || {});
  var mapping = ov.MAPPING || mappingFile;
  var format = String(config.FORMAT || 'teks').toLowerCase();
  if (format !== 'teks' && format !== 'json') throw new Error('CONFIG.FORMAT harus "teks" atau "json"');

  var dbAktif = config.DB ? db.getSiblingDB(config.DB) : db;
  var tz = (mapping && mapping.timezone) || TZ_DEFAULT;
  var ctx = { db: dbAktif, tz: tz, info: info, waktu: new Date() };

  var hasil;
  try {
    hasil = fnJalankan(config, mapping, ctx);
  } catch (e) {
    print('GAGAL [' + info.nama + ']: ' + (e && e.message ? e.message : String(e)));
    throw e;
  }

  var paket = {
    meta: {
      tool: info.nama,
      versi: info.versi,
      db: dbAktif.getName(),
      server: _versiServer(dbAktif),
      waktu: ctx.waktu,
      timezone: tz,
      statusMapping: mapping && mapping.meta ? mapping.meta.status || null : null,
    },
    hasil: hasil,
  };

  if (format === 'json') {
    print(PENANDA_JSON_AWAL);
    print(JSON.stringify(keJSONAman(paket), null, 2));
    print(PENANDA_JSON_AKHIR);
  } else {
    print(_headerTeks(paket.meta, ctx).concat(fnRender(hasil, ctx, config)).join('\n'));
  }
  return paket;
}
