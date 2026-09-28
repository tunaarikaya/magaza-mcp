# Üçüncü Taraf Bildirimleri

`magaza-mcp`, MIT lisansıyla dağıtılır. Bununla birlikte proje, üçüncü taraflarca
yayınlanan bazı spesifikasyon dosyalarını ve açık kaynak bağımlılıkları kullanır.
Bu belge onları ve hangi koşullarla kullanıldıklarını listeler.

## Spesifikasyonlar

### Apple Inc. — App Store Connect OpenAPI spesifikasyonu

- Dosya: `spec/appstore-openapi.json`
- Yayınlayan: Apple Inc.
- Kullanım: Bu dosya Apple tarafından App Store Connect API'sinin resmî
  tanımı olarak yayınlanır. `magaza-mcp` onu yalnızca okur ve
  `src/katalog/appstore.json` içindeki operasyon kataloğunu bu dosyadan üretir
  (`node scripts/uret-katalog.mjs`). Spesifikasyon üzerinde bir değişiklik
  yapılmaz; içeriği Apple'a aittir ve Apple'ın kendi şartlarına tabidir.

App Store, App Store Connect ve TestFlight, Apple Inc.'in tescilli markalarıdır.

### Google LLC — Android Publisher ve Play Developer Reporting discovery dökümanları

- Dosyalar: `spec/play.json` (Android Publisher API v3),
  `spec/play-reporting.json` (Play Developer Reporting API v1beta1)
- Yayınlayan: Google LLC
- Kullanım: Bu dosyalar Google tarafından ilgili API'lerin resmî makine okunur
  tanımları olarak yayınlanır. `magaza-mcp` onları yalnızca okur ve
  `src/katalog/play.json` içindeki operasyon kataloğunu bu dosyalardan üretir.
  Dökümanlar üzerinde bir değişiklik yapılmaz; içerikleri Google'a aittir ve
  Google'ın kendi şartlarına tabidir.

Google Play ve Play Console, Google LLC'nin tescilli markalarıdır.

> Bu proje bağımsız bir açık kaynak çalışmasıdır. Apple Inc. veya Google LLC ile
> bağlantılı değildir; onlar tarafından onaylanmamış, desteklenmemiş veya
> sponsor edilmemiştir.

## Bağımlılıklar

### @modelcontextprotocol/sdk

- Lisans: MIT
- Kullanım: MCP sunucu protokolünün uygulanması (araç listeleme, araç çağırma
  ve stdio taşıma katmanı).

### zod

- Lisans: MIT
- Kullanım: Şema tanımı ve doğrulama.

Geliştirme bağımlılıkları (`typescript`, `@types/node`) yayınlanan pakete dahil
değildir; ikisi de Apache-2.0 ve MIT lisanslıdır.

## Alınan kod

Bu projede şu an başka bir açık kaynak projeden kopyalanmış, uyarlanmış veya
türetilmiş herhangi bir kod parçası **bulunmamaktadır.** Tüm kaynak kod bu
depoya özgü olarak yazılmıştır.

İleride başka bir projeden bir kod parçası alınırsa, kaynağı (proje adı, bağlantı,
alınan dosya veya işlev) ve lisansı bu bölüme eklenir.
