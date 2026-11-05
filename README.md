# ERP Trace Mutation

Kumpulan script **mongosh read-only** untuk menelusuri mutasi stok ERP Kawasan Berikat / IT Inventory.

Transaksi dari banyak modul (Incoming, Material Out, Delivery, Production, Stock Adjustment, dan lainnya) disatukan menjadi satu **aliran mutasi** dengan bentuk seragam:

```text
tbl_incomingdetail ──────┐
tbl_materialkeluardetail ┤
tbl_deliverydetail ──────┤→ normalisasi → { sumber, tanggal, companyCode, kodeBarang,
tbl_productiondetail ────┤                 qty, arah: IN/OUT, idAsal, noAju, noReg, ... }
tbl_stokpenyesuaian... ──┘                              ↓
                                  kartu stok · duplikat · data yatim · anomali
```

Saldo dihitung dengan model `Saldo Akhir = Saldo Awal + Pemasukan − Pengeluaran ± Penyesuaian`, lalu ditelusuri sampai ke transaksi yang menyebabkan selisih.

---

## Status

Versi **0.1.0**: Fase 0 (fondasi).

| Fase | Isi | Status |
|---|---|---|
| 0 | Engine normalisasi berbasis mapping, helper periode WIB, build, test, tool `00-profil-skema` dan `00-cek-mapping` | Selesai |
| 1 | Mapping sesuai data asli + `01-mutasi` (saldo awal, IN, OUT, penyesuaian, saldo akhir, kartu stok dengan saldo berjalan) | Menunggu struktur data asli |
| 2 | `02-duplikat`, `03-orphan`, `04-anomali` | Belum |
| 3 | `05-cross-module`, template koreksi data yang aman, CI | Belum |

> **Mapping masih berstatus ASUMSI.** Nama koleksi di `config/mapping.js` diambil dari daftar koleksi yang sudah diketahui, sedangkan nama field masih tebakan. Jalankan alur verifikasi di bawah sebelum hasil tool dipakai untuk mengambil keputusan.

---

## Prinsip keamanan

- **Read-only.** Semua file di `dist/` hanya memakai `find` / `aggregate` / `count`. Ada test otomatis yang gagal bila muncul operasi tulis (`insert`, `update`, `delete`, `$out`, `$merge`, dan sejenisnya).
- **Beban dibatasi.** Sampel maksimal 5.000 dokumen per koleksi. Mode sampel bawaan memakai urutan `_id` (memanfaatkan index `_id`).
- **Disarankan dijalankan di secondary atau hasil restore dump** bila koleksinya besar.
- **Jangan commit kredensial atau output dari database asli.** `.env` dan folder `hasil/` sudah masuk `.gitignore`.

---

## Cara pakai

Setiap file di `dist/` berdiri sendiri: tidak perlu `require`, `load` tambahan, atau instalasi apa pun.

```bash
mongosh "mongodb://USER@HOST:27017/NAMA_DB?authSource=admin" --quiet --file dist/00-profil-skema.js
```

Cara lain:

- Di dalam sesi mongosh: `load("dist/00-profil-skema.js")`
- Paste seluruh isi file ke shell. Script aman di-paste ulang di sesi yang sama.

Hasil lengkap tersimpan di variabel `TRACE_HASIL`.

**Mengatur konfigurasi.** Ada dua cara:

1. Edit blok `KONFIGURASI` di bagian atas file `dist/`.
2. Override dari command line tanpa mengedit file:

   ```bash
   mongosh "mongodb://..." --quiet --eval 'var __TRACE_OVERRIDE__ = { CONFIG: { SUMBER: ["incoming"], PERIODE: "2026-10" } }' --file dist/00-cek-mapping.js
   ```

Menyimpan output ke file (folder `hasil/` tidak ikut ter-commit):

```bash
mkdir -p hasil
```
```bash
mongosh "mongodb://..." --quiet --file dist/00-profil-skema.js > hasil/profil-skema.txt
```

Lingkungan yang sudah dites: mongosh 2.14 dengan MongoDB 7.0. Operator yang dipakai (`$convert`, `$trim`, `$lookup`, `$type`) tersedia sejak MongoDB 4.0, tetapi versi di bawah 7.0 dan shell GUI (Studio 3T, NoSQLBooster, Compass) **belum dites**.

### Alur verifikasi mapping

1. Jalankan `dist/00-profil-skema.js` di database ERP untuk melihat field, tipe data, dan pola nilai yang sebenarnya. Nilai asli disamarkan, jadi output aman dibagikan.
2. Sesuaikan `config/mapping.js`, lalu jalankan `npm run build`. Setelah semuanya cocok, ubah `meta.status` menjadi `'TERVERIFIKASI'`.
3. Jalankan `dist/00-cek-mapping.js`. Targetnya, semua sumber `OK`, atau `PERINGATAN` yang penyebabnya sudah dipahami.

---

## Tool

### `00-profil-skema`: profil struktur koleksi

Tool ini menampilkan, untuk setiap field:

- persentase keterisian;
- tipe data BSON persis (`int`, `double`, `long`, `decimal`, `string`, dan lainnya, diambil dari `$type` di server);
- pola nilai yang disamarkan: `A` = huruf besar, `a` = huruf kecil, `9` = angka, karakter lain tetap. Contoh: `PT-ABC/2024/001` menjadi `AA-AAA/9999/999`.

Tool ini juga menandai:

- spasi di awal/akhir nilai;
- angka negatif, nol, dan pecahan;
- sebaran jam untuk field tanggal, untuk mengetahui cara ERP menyimpan tanggal WIB.

Nilai asli hanya ditampilkan untuk field "enum", yaitu field dengan variasi nilai sedikit dan berulang (misalnya `status` atau jenis dokumen). Fitur ini bisa dimatikan dengan `TAMPILKAN_ENUM: false`.

| CONFIG | Default | Keterangan |
|---|---|---|
| `KOLEKSI` | `[]` | `[]` = semua koleksi di MAPPING (detail + header) |
| `SAMPEL` | `200` | Dokumen per koleksi (maks 5.000) |
| `MODE_SAMPEL` | `'terbaru'` | `'terbaru'` (urut `_id` menurun) atau `'acak'` (`$sample`) |
| `TAMPILKAN_ENUM` | `true` | Tampilkan nilai asli untuk field enum |
| `ENUM_MAKS` | `8` | Batas nilai unik supaya dianggap enum |
| `KEDALAMAN_MAKS` | `4` | Kedalaman field bersarang yang ditelusuri |
| `DB` | `null` | `null` = database di connection string |
| `FORMAT` | `'teks'` | `'teks'` atau `'json'` |

Contoh output (data dummy dari test):

```text
--- uji_incomingdetail -------------------------------------------------------
Estimasi dokumen: 8 | sampel: 8 (terbaru)
FIELD          ADA  TIPE                             INFO
-----------  -----  -------------------------------  --------------------------------------------------------------------------------------
_id           100%  objectId
tanggal       100%  date                             jam WIB: 00:00 (75%), 10:15 (12,5%), 23:59 (12,5%) | rentang 2025-11-01 s/d 2025-12-01
companyCode   100%  string                           nilai: "PT1" (7), "PT2" (1)
kodeBarang    100%  string                           pola: "AA-999" (7), "AA-999 " (1) | spasi di awal/akhir: 1
qty           100%  int 50%, double 25%, string 25%  pola: "9.999,9" (1), "99" (1) | angka: pecahan 1
noAju         100%  string                           pola: "999999" (8)
status        100%  string                           nilai: "POSTED" (7), "DRAFT" (1)
idAsal       12,5%  null

--- uji_IncomingDetail -------------------------------------------------------
TIDAK DITEMUKAN. Mungkin maksudnya: uji_incomingdetail
```

### `00-cek-mapping`: cek kecocokan mapping dengan data

Untuk setiap sumber di MAPPING, tool ini memeriksa hal-hal berikut:

1. struktur mapping (validasi statis);
2. keberadaan koleksi, disertai saran nama bila salah ketik;
3. keterisian field wajib dan opsional;
4. tipe field tanggal dan qty;
5. hasil penentuan arah IN/OUT;
6. relasi detail ke header (detail yatim, header ganda, tipe link yang tidak cocok).

| CONFIG | Default | Keterangan |
|---|---|---|
| `SUMBER` | `[]` | `[]` = semua sumber di MAPPING, mis. `['incoming', 'delivery']` |
| `SAMPEL` | `500` | Dokumen detail terbaru per sumber (maks 5.000) |
| `PERIODE` | `null` | `'2026-10'`, `'2026'`, `'2026-10-15'`, atau `{ dari: '2026-10-01', sampai: '2026-10-15' }` |
| `COMPANY_CODE` | `null` | Batasi ke satu companyCode |
| `DB` | `null` | `null` = database di connection string |
| `FORMAT` | `'teks'` | `'teks'` atau `'json'` |

Kode temuan:

| Kode | Level | Arti |
|---|---|---|
| `VALIDASI` | ERROR / PERINGATAN | Struktur mapping salah atau ada salah ketik |
| `KOLEKSI_TIDAK_ADA`, `HEADER_KOLEKSI_TIDAK_ADA` | ERROR | Koleksi tidak ditemukan (disertai kandidat nama) |
| `FIELD_WAJIB_KOSONG_SEMUA` | ERROR | Field wajib tidak pernah terisi; nama field kemungkinan salah |
| `HEADER_TIDAK_TERHUBUNG` | ERROR | Tidak ada detail yang menemukan header-nya (disertai saran `konversi`) |
| `TANGGAL_BUKAN_DATE` | ERROR / PERINGATAN | Tanggal tersimpan bukan sebagai Date, sehingga tidak tertangkap filter periode |
| `FIELD_WAJIB_KOSONG_SEBAGIAN` | PERINGATAN | Field wajib kosong di sebagian dokumen |
| `FIELD_OPSIONAL_KOSONG` | PERINGATAN | Field opsional selalu kosong; cek nama field |
| `QTY_STRING` | PERINGATAN | qty bertipe string (dipisahkan antara yang bisa dan tidak bisa dikonversi) |
| `QTY_BUKAN_ANGKA` | PERINGATAN | qty bertipe selain angka/teks |
| `QTY_NEGATIF` | PERINGATAN | qty negatif pada sumber berarah tetap |
| `KODE_SPASI` | PERINGATAN | kodeBarang punya spasi di awal/akhir; barang yang sama bisa terhitung terpisah |
| `KODE_BUKAN_STRING` | PERINGATAN | kodeBarang bukan string |
| `ARAH_TIDAK_DIKENAL` | PERINGATAN | Nilai field arah tidak ada di `arah.nilai` |
| `DETAIL_YATIM` | PERINGATAN | Detail tanpa header |
| `HEADER_GANDA` | PERINGATAN | Detail cocok ke lebih dari satu header |
| `TANGGAL_MASA_DEPAN` | PERINGATAN | Tanggal lebih dari 1 hari ke depan |
| `SAMPEL_KOSONG` | PERINGATAN | Tidak ada dokumen yang cocok dengan filter |

Contoh output (data dummy dari test):

```text
[PERINGATAN] masuk | Incoming (uji) | uji_incomingdetail | arah IN | kategori BB
              sampel 8 dokumen
              - INFO       Rentang tanggal sampel 2025-11-01 s/d 2025-12-01 | jam WIB: 00:00 75%, 10:15 12,5%, 23:59 12,5%
              - INFO       Tipe qty: int 50%, double 25%, string 25%
              - PERINGATAN qty bertipe string di 2 dokumen (1 bisa dikonversi ke angka, 1 tidak: pola "9.999,9" 1).
              - PERINGATAN kodeBarang punya spasi di awal/akhir di 1 dokumen (bisa bikin barang yang sama terhitung terpisah).
              - INFO       companyCode: "PT1" 7, "PT2" 1
              - INFO       Arah: IN 8

[PERINGATAN] penyesuaian | Penyesuaian (uji) | uji_penyesuaiandetail + uji_penyesuaianheader | arah dari field jenis (TAMBAH->IN, KURANG->OUT)
              sampel 4 dokumen
              - PERINGATAN 1 detail tidak punya header (header terhapus atau link salah).
              - INFO       Rentang tanggal sampel 2025-11-08 s/d 2025-11-09 | jam WIB: 00:00 100%
              - INFO       Tipe qty: double 100%
              - INFO       companyCode: "PT1" 3
              - INFO       Arah: IN 2, OUT 1, TIDAK_DIKENAL 1
              - PERINGATAN Arah tidak dikenali di 1 dokumen. Nilai asli: "KOREKSI" (1). Tambahkan ke arah.nilai bila memang valid.

Ringkasan: 1 OK | 2 PERINGATAN | 0 ERROR
```

---

## Mapping (`config/mapping.js`)

Semua nama koleksi dan field ditulis di satu file ini. Tool tidak meng-hardcode nama field. Format lengkapnya dijelaskan di komentar bagian atas file. Ringkasnya:

```js
sumber: {
  incoming: {
    label: 'Incoming Warehouse',
    koleksi: 'tbl_incomingdetail',
    arah: 'IN',                    // 'IN' | 'OUT' | 'TANDA_QTY' | { field, dari, nilai }
    kategori: 'BB',
    hitungMutasi: true,            // false = tidak ikut dihitung di saldo
    filter: { isDeleted: { $ne: true } },
    field: { tanggal: 'tanggal', companyCode: 'companyCode', kodeBarang: 'kodeBarang', qty: 'qty', idAsal: 'idAsal' },
  },
  penyesuaian: {
    koleksi: 'tbl_stokpenyesuaiandetail',
    arah: { field: 'jenis', nilai: { TAMBAH: 'IN', KURANG: 'OUT' } },   // dibandingkan setelah trim + huruf besar
    field: { kodeBarang: 'kodeBarang', qty: 'qty' },
    header: {                      // field yang ada di koleksi header
      koleksi: 'tbl_stokpenyesuaianheader',
      localField: 'idHeader', foreignField: '_id',
      konversi: 'toObjectId',      // idHeader string -> ObjectId
      field: { tanggal: 'tanggal', companyCode: 'companyCode', noTransaksi: 'noDokumen' },
    },
  },
}
```

- **Field logis wajib:** `tanggal`, `companyCode`, `kodeBarang`, `qty`
- **Field logis opsional:** `noTransaksi`, `idAsal`, `idDokumen`, `noAju`, `noReg`, `noUrut`, `jenisDokumen`, `satuan`, `gudang`, `createdAt`

**Periode selalu dihitung dalam WIB** (`timezone: '+07:00'`) dengan batas atas eksklusif. Contoh November 2026:

```js
{ $gte: ISODate("2026-10-31T17:00:00Z"), $lt: ISODate("2026-11-30T17:00:00Z") }
```

---

## Development

Prasyarat: Node.js >= 22 dan Docker (untuk MongoDB test). Tidak ada dependency npm.

```bash
npm run db:up
```
```bash
npm test
```
```bash
npm run test:integrasi
```
```bash
npm run build
```
```bash
npm run db:down
```

| Script | Fungsi |
|---|---|
| `npm run db:up` / `db:down` | Menyalakan/mematikan MongoDB test (container `erp-trace-mongo`, port 27018). Versi image bisa diatur: `MONGO_VERSION=6.0 npm run db:up` |
| `npm test` | Test unit: helper, validasi mapping, pipeline, dan pemeriksaan `dist/` (up-to-date, sintaks, read-only) |
| `npm run test:integrasi` | Menjalankan file `dist/` di mongosh sungguhan terhadap data dummy berisi anomali yang sengaja ditanam |
| `npm run build` | Menyusun ulang `dist/` dari `src/` + `config/mapping.js` |
| `npm run cek:dist` | Gagal bila `dist/` belum dibuild ulang |

Untuk memakai mongosh lokal (bukan di dalam container), set environment variable sebelum test integrasi:

```bash
MONGOSH_BIN=mongosh MONGO_URI_DASAR=mongodb://localhost:27018 npm run test:integrasi
```

### Struktur

```text
config/mapping.js       mapping koleksi & field (satu-satunya yang disesuaikan per ERP)
src/lib/                tanggal (WIB), teks (pola/kandidat), tabel, bson, mapping (validasi),
                        sumber (pipeline normalisasi), runner (lapisan mongosh)
src/tools/              satu file per tool: blok CONFIG + jalankan() + render()
scripts/build.js        gabungkan CONFIG + MAPPING + lib + tool -> dist/<tool>.js
dist/                   hasil build, siap dijalankan (ikut di-commit)
test/unit/              test Node tanpa database
test/integrasi/         test terhadap MongoDB (docker compose)
test/fixtures/          mapping & data dummy berisi anomali tertanam
```

### Aturan kode

Script dijalankan di mongosh, jadi ada beberapa aturan:

- Tidak ada operasi tulis di `src/tools/`. Test `build.test.js` memeriksanya.
- Panggilan shell API (`db.x.find()`, `aggregate()`) tidak boleh diletakkan di dalam callback (`map`, `forEach`, `sort`). Pakai loop `for` biasa supaya aman dengan async rewriter mongosh.
- Kode yang khusus untuk Node (`require` / `module.exports`) diletakkan di dalam `// #region node-only` ... `// #endregion`. Bagian ini dibuang saat build.
- Hindari sintaks JavaScript yang sangat baru (`?.`, `??`) supaya tetap aman di engine JS shell yang lebih lama.
- Setiap perubahan di `src/` atau `config/` harus diikuti `npm run build`, lalu ikut commit `dist/`.

---

## Batasan yang diketahui

- Filter yang field-nya ada di koleksi header (misalnya tanggal penyesuaian) diterapkan **setelah** `$lookup`. Untuk koleksi besar, sertakan filter yang ada di detail, seperti `kodeBarang`.
- Filter `kodeBarang` mencocokkan nilai mentah secara persis. Kode yang mengandung spasi tidak ikut tertangkap. Kasus ini dilaporkan `00-cek-mapping` sebagai `KODE_SPASI`.
- qty berbentuk teks dengan format Indonesia (`"1.234,5"`) **sengaja tidak dikonversi otomatis** supaya tidak salah tebak. Kasus ini dilaporkan sebagai `QTY_STRING`.
- Tanggal yang tersimpan sebagai string tidak tertangkap filter periode. Kasus ini dilaporkan sebagai `TANGGAL_BUKAN_DATE`.
- Untuk field di dalam array, tipe `int` dan `double` hanya terbaca sebagai `int/double` (keterbatasan di sisi klien).
- Transaksi yang di-*hard delete* tidak bisa dilacak langsung. Jejaknya hanya terlihat dari referensi yang yatim (Fase 2).
