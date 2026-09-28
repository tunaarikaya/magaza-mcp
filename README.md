# Mağaza MCP

App Store Connect ve Google Play'i tek MCP sunucusunda birleştirir; yapay zekâ asistanın iki mağazayı da yönetir.

[![npm](https://img.shields.io/npm/v/magaza-mcp.svg)](https://www.npmjs.com/package/magaza-mcp)
[![Lisans: MIT](https://img.shields.io/badge/lisans-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

`magaza-mcp`, kullandığın yapay zekâ asistanını (Claude, Antigravity, Cursor, Codex, Windsurf) doğrudan App Store Connect ve Google Play hesaplarına bağlar. Tek bir kurulum sihirbazı çalıştırırsın; asistan bundan sonra uygulamalarını, sürümlerini, aboneliklerini, yorumlarını ve satın almalarını okuyup düzenleyebilir. İki mağaza, tek kurulum, tek sunucu.

## Neden bu var?

Piyasadaki MCP sunucularının hepsi tek mağazalı: ya sadece App Store Connect'e ya da sadece Google Play'e bağlanıyorlar. İkisini aynı anda kullanmak istiyorsan iki ayrı sunucu kuruyor, iki ayrı araç setiyle uğraşıyor ve iki mağazayı karşılaştıran her soruyu elle birleştiriyorsun.

Bildiğimiz kadarıyla `magaza-mcp`, iki mağazayı tek pakette birleştiren ilk proje. Bunun asıl kazancı araç listesinin uzaması değil: **iki mağazayı aynı anda sorgulayabilen araçlar ancak böyle mümkün oluyor.** "Aynı uygulamanın aboneliği App Store'da ve Play'de kaç para?" ya da "Kullanıcı ödedi ama premium göremiyor, sorun hangi mağazada?" gibi sorular, iki API'ye aynı çağrıda erişebilen bir sunucu olmadan cevaplanamaz.

## Kurulum

```bash
npx magaza-mcp kur
```

Sihirbaz sırasıyla şunları sorar:

1. **Hangi mağazaları bağlayalım?** — App Store Connect, Google Play veya ikisi.
2. **App Store Connect anahtarı** — Key ID, Issuer ID ve `.p8` özel anahtar dosyanın yolu. Anahtarı App Store Connect → Kullanıcılar ve Erişim → Entegrasyonlar bölümünden oluşturursun. Sihirbaz anahtarı kaydetmeden önce Apple'a gerçek bir istek atıp doğrular; kaç uygulama gördüğünü söyler.
3. **Google Play servis hesabı** — Google Cloud Console'dan indirdiğin servis hesabı JSON anahtarının yolu. Bu da kaydedilmeden önce Google'a karşı doğrulanır.
4. **Hangi uygulamalara kurulsun?** — Makinende kurulu görünen istemciler işaretli gelir, istediklerini seçersin.

Desteklenen istemciler ve yazılan ayar dosyaları:

| İstemci | Ayar dosyası |
| --- | --- |
| Claude Code | `~/.claude.json` |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Antigravity (IDE + CLI) | `~/.gemini/config/mcp_config.json` |
| Cursor | `~/.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Codex | `~/.codex/config.toml` |

Mevcut ayarlarına dokunulmaz — sadece `magaza-mcp` girdisi eklenir veya güncellenir ve her yazmadan önce dosyanın `.magaza-mcp-yedek` uzantılı bir kopyası alınır.

**Anahtarların ayar dosyasına yazılmaz.** macOS'ta Anahtar Zinciri'ne (Keychain) kaydedilirler; ayar dosyasına yalnızca hangi mağazaların açık olduğunu söyleyen `MAGAZALAR` değişkeni girer. Anahtar Zinciri'ne erişilemeyen sistemlerde izinleri `0600`'e kilitlenmiş bir dosyaya düşülür.

Kurulumdan sonra açık olan uygulamaları yeniden başlat.

Diğer komutlar:

```bash
npx magaza-mcp araclar     # Yüklü araçları listele (✎ = veri değiştirebilir)
npx magaza-mcp surum       # Sürümü yazdır
npx magaza-mcp yardim      # Yardım
npx magaza-mcp             # MCP sunucusunu başlat (istemciler bunu çağırır)
```

## Yapay zekâya kurdurmak

Terminalle uğraşmak istemiyorsan kurulumu asistanına yaptırabilirsin. Kullandığın
yapay zekâya (Claude Code, Antigravity, Cursor, Codex…) şunu yaz:

> https://github.com/tunaarikaya/magaza-mcp — bunu kur, AGENTS.md'yi oku

Asistan repodaki [AGENTS.md](AGENTS.md) dosyasını okuyup gerisini halleder:
paketi tanır, ayar dosyalarına kaydeder, kurulumu doğrular.

**Anahtarını asistan görmez.** Kayıt işini o yapar ama anahtar girme kısmını
sana bırakır — `npx magaza-mcp kur` komutunu sen çalıştırırsın ve anahtar
bilgisayarından hiç çıkmaz. AGENTS.md asistana bunu açıkça söyler: `.p8`
dosyanı isteme, okuma, ekrana basma.

Asistanın kullandığı komutlar (sen de elle çalıştırabilirsin):

```bash
npx magaza-mcp durum --json                      # neyin bağlı olduğunu gör
npx magaza-mcp kaydet --magazalar appstore,play  # ayar dosyalarına yaz
npx magaza-mcp kur                               # anahtarı SEN girersin
```

## İki mağaza karışır mı?

Hayır — ve bu tesadüf değil, tasarımın kendisi.

**Araç isimleri önekle ayrılmıştır.** App Store Connect'e giden her araç `appstore__` ile, Google Play'e giden her araç `play__` ile başlar. Bir araç asla iki API'ye birden gitmez; `appstore__yorumlar` yalnızca Apple'ın `customerReviews` uç noktasını, `play__yorumlar` yalnızca Android Publisher'ın `reviews` uç noktasını çağırır. İsimlerin karışma ihtimali yok, çünkü ortak isim yok.

**Seçmediğin mağazanın araçları hiç yüklenmez.** Kurulumda hangi mağazaları seçtiğin ayar dosyasındaki `MAGAZALAR` değişkenine yazılır. Sunucu açılışta bu değişkeni okur ve araç listesini ona göre kurar: sadece App Store seçtiysen hiçbir `play__` aracı belleğe bile alınmaz, modeline sunulan araç listesinde görünmez, token harcamaz. Tersi de geçerli. Yani tek paket kurarsın ama pratikte iki bağımsız sunucudan hangisini istiyorsan o çalışır.

**Çapraz araçlar yalnızca iki mağaza da açıkken var olur.** `magaza__` önekli çapraz araçlar (genel bakış, abonelik karşılaştırma, satın alma teşhisi) tek mağazalı kurulumda hiç oluşturulmaz — anlamları olmadığı için.

**Ortak dispatch araçları da kapsamını bilir.** `magaza__endpoint_ara` ve `magaza__cagir` araçlarının `magaza` parametresi, yalnızca kurduğun mağazaları kabul eden bir enum'dur. Sadece Play kurduysan model `magaza: "appstore"` diye bir çağrı yapamaz; şema buna izin vermez.

## Ne sorabilirsin

Aşağıdaki örneklerdeki uygulama adları uydurmadır; sen kendi uygulamalarının adını kullanırsın.

- "İki mağazadaki uygulamalarımı listele, hangisi nerede yayında?"
- "Nota Defteri uygulamasının aylık aboneliği App Store'da ve Play'de Türkiye'de kaç para? Fark var mı?"
- "Bir kullanıcı ödeme yaptığını ama premium açılmadığını söylüyor. Nota Defteri'nin satın alma kurulumunu iki mağazada da kontrol et."
- "App Store'da hangi sürümüm incelemede takıldı?"
- "Dün yüklediğim TestFlight build'i işlenmesi bitti mi?"
- "Son bir haftadaki 1 ve 2 yıldızlı App Store yorumlarını özetle, en sık şikâyet ne?"
- "Şu Play yorumuna kibar bir yanıt yaz, ama önce bana göster."
- "Nota Defteri'nin Play'deki çökme oranı son 14 günde arttı mı?"
- "Bu Play satın alma token'ı geçerli mi, abonelik hâlâ aktif mi?"
- "Play'de hangi sürüm production kanalında ve yüzde kaç kullanıcıya açık?"
- "Hazırlanmakta olan sürümün 'Bu sürümde neler yeni' metnini güncelle."

## Araçlar

Araç adlarındaki önek hangi mağazaya gidildiğini söyler. ✎ işaretli araçlar veri değiştirir.

### App Store Connect (`appstore__`)

| Araç | Ne yapar |
| --- | --- |
| `appstore__uygulamalar` | Hesaptaki uygulamaları listeler: ad, bundle ID, SKU, birincil dil ve diğer araçların istediği `id`. |
| `appstore__surumler` | Bir uygulamanın App Store sürümlerini ve durumlarını gösterir (hazırlanıyor, incelemede, yayında, reddedildi). |
| `appstore__buildler` | TestFlight build'lerini, işlenme durumlarını ve son kullanma tarihlerini listeler. |
| `appstore__yorumlar` | Müşteri yorumlarını getirir; puana ve ülkeye göre süzülebilir. |
| `appstore__yorum_yanitla` ✎ | Bir yoruma geliştirici yanıtı yazar (Apple incelemesinden sonra yayınlanır). |
| `appstore__abonelikler` | Abonelik gruplarını ve içlerindeki abonelikleri listeler: ürün kimliği, süre, durum. |
| `appstore__abonelik_fiyatlari` | Bir aboneliğin ülke ülke müşteri fiyatlarını ve geliştirici gelirini getirir. |
| `appstore__iap_urunler` | Tek seferlik uygulama içi satın alma ürünlerini listeler. |
| `appstore__testflight_gruplari` | TestFlight beta gruplarını, genel davet linklerini ve kotalarını gösterir. |
| `appstore__metin_guncelle` ✎ | Hazırlanmakta olan sürümün mağaza metinlerini günceller: sürüm notları, açıklama, anahtar kelimeler, tanıtım metni. |
| `appstore__satis_raporu` | Satış/indirme raporunu indirir (günlük, haftalık, aylık, yıllık; satış, abonelik, abonelik olayı, abone). |

### Google Play (`play__`)

| Araç | Ne yapar |
| --- | --- |
| `play__uygulamalar` | Servis hesabının eriştiği uygulamaları listeler; diğer araçların istediği paket adını buradan alırsın. |
| `play__kanallar` | Yayın kanallarını (internal, alpha, beta, production) ve her kanaldaki sürümleri, kullanıcı yüzdeleriyle birlikte gösterir. |
| `play__yorumlar` | Kullanıcı yorumlarını getirir; istenirse çevirir. Play API'si yalnızca son ~1 haftayı verir. |
| `play__yorum_yanitla` ✎ | Bir yoruma geliştirici yanıtı yazar (en fazla 350 karakter). |
| `play__abonelikler` | Abonelikleri ve temel planlarını (base plan) listeler: süre, durum, fiyatlandırılan ülke sayısı. |
| `play__abonelik_fiyatlari` | Bir temel planın ülke ülke fiyatlarını ve yeni abonelere açık olup olmadığını getirir. |
| `play__urunler` | Tek seferlik ürünleri listeler; yeni (`oneTimeProducts`) ve eski (`inappproducts`) modelin ikisini de dener. |
| `play__satin_alma_dogrula` | Bir satın alma token'ını doğrular: abonelik durumu, onay durumu, bitiş tarihi, test satın alması mı. |
| `play__iade_edilenler` | İptal edilmiş, iade edilmiş veya geri alınmış satın almaları listeler. |
| `play__cokme_orani` | Android vitals çökme oranını ve etkilenen kullanıcı sayısını günlük olarak getirir. |

### İki mağaza birden (`magaza__`)

Bu araçlar yalnızca iki mağaza da bağlıyken yüklenir.

| Araç | Ne yapar |
| --- | --- |
| `magaza__genel_bakis` | İki mağazadaki uygulamaları tek listede toplar; aynı ürünün iOS/Android eşlerini yan yana koyar, sadece tek mağazada olanları ayırır. |
| `magaza__abonelik_karsilastir` | Aynı uygulamanın aboneliklerini iki mağazada karşılaştırır: ürün kimlikleri, süreler ve istenen ülkedeki fiyatlar. Ülke kodunu iki mağazanın istediği biçime kendi çevirir. |
| `magaza__iap_teshis` | "Ödedi ama premium göremiyor" sorunlarını teşhis eder: ürünler yayında mı, o ülkede fiyatı var mı, plan yeni abonelere açık mı; Play satın alma token'ı verirsen onu da doğrular ve bulguları madde madde yazar. |

### Tüm API'ye erişim (`magaza__`)

| Araç | Ne yapar |
| --- | --- |
| `magaza__endpoint_ara` | Bağlı mağazaların API'lerinin tamamında uç nokta arar; operasyon adını, HTTP yöntemini, yolunu ve parametrelerini döndürür. |
| `magaza__cagir` ✎ | Bulunan operasyonu çalıştırır. Yol parametrelerini otomatik yerine koyar; veri değiştiren işlemler `onayla=true` olmadan çalışmaz. |
| `magaza__sema` | Bir operasyonun istek gövdesinin nasıl olması gerektiğini gösterir; POST/PATCH çağrılarından önce kullanılır. |

## Tam API erişimi

Yukarıdaki seçilmiş araçlar günlük işin büyük kısmını görür. Geri kalanı için sunucu, iki mağazanın API'lerinin **tamamını** taşır — toplam **1281 operasyon**:

| Kaynak | Operasyon |
| --- | --- |
| App Store Connect API v4.5 | 1111 |
| Android Publisher API v3 | 145 |
| Play Developer Reporting API v1beta1 | 25 |

Hazır araçlar arasında işini görecek bir şey yoksa model önce `magaza__endpoint_ara` ile aradığı işlemi bulur, sonra `magaza__cagir` ile çalıştırır.

### Neden hepsi ayrı araç değil?

Çünkü bedeli ağır olurdu. MCP araç tanımları her istekte bağlama girer — yani yüklü araç listesi, sen hiçbirini kullanmasan bile her mesajda tekrar tekrar ödenir.

| | Araç sayısı | Araç tanımlarının bağlamdaki maliyeti |
| --- | --- | --- |
| **magaza-mcp** | 27 | **~3.500 token** |
| 1281 operasyonun hepsi ayrı araç olsaydı | 1281 | ~184.000 token |

Kapalı özellik yok: 1281 operasyonun tamamına erişilebiliyor, ama kullanılmayanın maliyeti sıfır. Model bir şeye ihtiyaç duyduğu anda arayıp buluyor.

Bu yüzden `magaza-mcp`'de "şu özelliği açayım mı, token yer" diye bir ayar da yok — açılacak bir şey yok, hepsi zaten erişilebilir.

Katalogların tamamı Apple ve Google'ın **resmî spesifikasyonlarından** üretilir: Apple'ın yayınladığı App Store Connect OpenAPI dosyası ile Google'ın Android Publisher ve Play Developer Reporting discovery dökümanları. Elle yazılmış uç nokta listesi yoktur; spesifikasyon güncellendiğinde katalog yeniden üretilir. Eskimiş (deprecated) işaretli operasyonlar katalog dışı bırakılır.

## Gereken izinler

**App Store Connect.** Anahtarı oluştururken **App Manager** rolü yeterlidir; Admin gerekmez. İstisnalar: kullanıcı ve erişim yönetimi uç noktaları ile bazı analitik raporlar daha yüksek yetki ister. Sözleşme, vergi ve banka bilgileri hiçbir API anahtarıyla okunamaz (aşağıya bak).

**Google Play.** İki adım gerekir ve ikisi de şart:

1. Servis hesabının **Play Console → Kullanıcılar ve izinler** bölümünden davet edilmesi ve ilgili uygulamalara izin verilmesi.
2. Servis hesabının bulunduğu Google Cloud projesinde **Android Publisher API** ve **Play Developer Reporting API**'nin etkinleştirilmiş olması. Uygulama listelemesi ve çökme metrikleri Reporting API'sinden geldiği için ikincisi de gerçekten gereklidir.

## Güvenlik

- **Anahtarlar Anahtar Zinciri'nde.** Apple `.p8` özel anahtarı ve Google servis hesabı JSON'u macOS Anahtar Zinciri'nde saklanır; ayar dosyalarına, ortam değişkenlerine veya repoya yazılmaz. Anahtar Zinciri'nin olmadığı sistemlerde izinleri `0600` olan bir dosyaya düşülür.
- **Veri değiştiren işlemler onay ister.** `magaza__cagir` ile yapılan POST/PATCH/PUT/DELETE çağrıları ilk seferde çalışmaz: ne yapılacağını, beklenen gövdeyi ve uyarıyı döndürür; işlem ancak kullanıcı onayladıktan sonra `onayla=true` ile tekrarlandığında yürür.
- **Salt-okunur mod.** `--salt-okunur` bayrağı (veya `SALT_OKUNUR=1`) yazma yapabilen bütün araçları listeden tamamen çıkarır. Model onları göremez, dolayısıyla çağıramaz.
- **Telemetri yok.** Sunucu hiçbir analitik, hata raporu veya kullanım verisi göndermez. Ağ trafiği yalnızca `api.appstoreconnect.apple.com`, `androidpublisher.googleapis.com` ve `playdeveloperreporting.googleapis.com` adreslerine gider. Araya giren bir sunucu yoktur; verilerin doğrudan Apple ve Google ile senin makinen arasında akar.

## Sorun giderme

**Apple 401 döndürüyor.** Key ID, Issuer ID ve `.p8` dosyası birbirine ait olmayabilir — üçü aynı anahtara ait olmalı. Uyuşuyorlarsa sistem saatine bak: imzalanan JWT 20 dakika ömürlüdür ve saati kaymış bir makinede üretilen token Apple tarafından reddedilir. Ayrıca `.p8` dosyasının bir App Store Connect API anahtarı olduğundan emin ol; StoreKit veya push anahtarları burada çalışmaz.

**Apple 403 döndürüyor.** Anahtarın rolü o işlem için yetersiz. App Manager çoğu şeye yeter; kullanıcı yönetimi ve bazı raporlar daha fazlasını ister. Ama bir şeyi baştan bilmekte fayda var: **sözleşme, vergi ve banka bilgileri hiçbir API anahtarıyla okunamaz.** Apple bu verileri API'ye hiç açmaz; yalnızca Hesap Sahibi (Account Holder) rolündeki kişi App Store Connect arayüzünden görebilir. Buradaki 403 bir yapılandırma hatası değildir, düzeltilemez.

**Play 403 döndürüyor, `inappproducts` uç noktasında.** Uygulama Google'ın yeni ürün modeline geçmiştir; eski `inappproducts` uç noktası artık kapalıdır ve `oneTimeProducts` kullanılmalıdır. `play__urunler` aracı bunu kendisi halleder: önce yeni uç noktayı dener, olmazsa eskisine düşer ve hangi modeli kullandığını çıktıda söyler.

**Play 403 döndürüyor, genel olarak.** Servis hesabı Play Console'da uygulamaya davet edilmemiş olabilir. Davet ettikten sonra izinlerin yayılması birkaç dakika sürebilir; hemen denemek yerine biraz bekle. Davet tamamsa Cloud projesinde Android Publisher API ve Play Developer Reporting API'nin açık olduğunu doğrula.

**"Play uygulamalarımı listele" neden Reporting API'sinden geliyor?** Çünkü Android Publisher API'sinde uygulama listeleme uç noktası yoktur — Google böyle bir uç nokta hiç yayınlamadı. Paket adını bilmeden hiçbir Publisher çağrısı yapılamadığı için liste, Play Developer Reporting API'sinin `apps:search` uç noktasından alınır. Bu yüzden Reporting API'si sadece çökme metrikleri için değil, temel kullanım için de açık olmalıdır.

**Play'de sürüm/kanal bilgisi neden bazen gecikiyor?** Play'de kanal bilgisi ancak bir "düzenleme oturumu" (edit) içinden okunabilir. Okuma araçları bu oturumu kendileri açar, okur ve commit etmeden bırakır — yani hiçbir değişiklik yaratmaz — ama bu fazladan iki HTTP çağrısı demektir.

## Geliştirme

```bash
git clone https://github.com/tunaarikaya/magaza-mcp.git
cd magaza-mcp
npm install
npm run build      # TypeScript derle
npm run kontrol    # Tip kontrolü (tsc --noEmit)
npm run dev        # İzleme modunda derleme
```

Araç kataloglarını spesifikasyonlardan yeniden üretmek için:

```bash
node scripts/uret-katalog.mjs
```

Bu komut `spec/appstore-openapi.json`, `spec/play.json` ve `spec/play-reporting.json` dosyalarını okur ve `src/katalog/` altındaki katalogları yeniden yazar. Apple veya Google spesifikasyonunu güncellediğinde bu komutu çalıştırman yeterli; operasyon listesi elle düzenlenmez.

## Benzer projeler

Bu alanda önce yola çıkmış, iyi iş yapan projeler var. İhtiyacın tek mağazayla sınırlıysa bunlara bakmanı içtenlikle öneririz:

- **[app-store-connect-mcp (Heimdall)](https://github.com/erayendes/app-store-connect-mcp)** — App Store Connect API'sinin tamamını 890 araçla kapsayan, profil sistemiyle araç setini daraltmana izin veren çok kapsamlı bir sunucu. Sadece iOS tarafıyla ilgileniyorsan bu alandaki en derin proje.
- **[app-store-connect-mcp-server](https://github.com/JoshuaRileyDev/app-store-connect-mcp-server)** — Alanın ilki. App Store Connect'i bir MCP sunucusunun arkasına koyma fikrini ilk kuran proje; sonradan gelen herkes bir şekilde buna borçlu.
- **[google-play-developer-mcp](https://github.com/devinwang/google-play-developer-mcp)** — Play tarafında kapsamlı ve olgun bir sunucu. Yalnızca Android yayınlıyorsan işini fazlasıyla görür.

Farkımız şu: bu projelerin hepsi tek mağazaya bakar. `magaza-mcp` ikisini tek kurulumda birleştirir ve iki mağazayı aynı çağrıda karşılaştırabilen araçlar sunar — tek mağazalı bir sunucuda yapılamayan şey tam olarak budur.

## Lisans

MIT — ayrıntılar için [LICENSE](LICENSE) dosyasına bak. Üçüncü taraf kaynaklar için [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

App Store, TestFlight, App Store Connect, Google Play ve Play Console adları sahiplerinin tescilli markalarıdır. Bu proje bağımsız bir açık kaynak çalışmasıdır; Apple Inc. veya Google LLC ile bağlantılı değildir, onlar tarafından onaylanmamış, desteklenmemiş veya sponsor edilmemiştir.
