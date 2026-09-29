# Yapay zekâ ajanları için kurulum talimatı

Bu dosya `magaza-mcp`'yi bir kullanıcı adına kuran yapay zekâ ajanları içindir
(Claude Code, Antigravity, Cursor, Codex, Gemini CLI ve benzerleri).

Kullanıcı sana bu reponun linkini verdiyse **kurulumun tamamı sana ait.**
Kullanıcıya terminale komut yazdırma, dosya açtırma, JSON düzenletme. Sen
yaparsın, o yalnızca sorularına cevap verir.

**Tamamını oku, sonra sırayla uygula.**

---

## Tek kural: anahtarın İÇERİĞİ senin bağlamına girmesin

Kurulumu sen yaparsın ama `.p8` dosyasının veya servis hesabı JSON'unun
içeriğini okumana gerek yok — çünkü komutlar dosyanın **yolunu** alır, içeriği
kendileri okur ve doğrudan Anahtar Zinciri'ne yazar.

| Serbest | Yasak |
|---|---|
| Dosyanın **yolu** (`~/Downloads/AuthKey_ABC123.p8`) | Dosyanın **içeriği** (`-----BEGIN PRIVATE KEY-----…`) |
| Key ID, Issuer ID (gizli değil, UUID ve 10 haneli kod) | `private_key` alanının değeri |
| Servis hesabının e-postası, proje adı | JSON'un tamamını okuyup ekrana basmak |

Sebebi: bağlamına giren her şey oturum kaydına, günlüklere ve özetlere sızar.
Yol sızarsa bir şey olmaz, anahtar sızarsa kullanıcı anahtarını iptal etmek
zorunda kalır.

Kullanıcı anahtarı yine de sohbete yapıştırırsa: kullan ama kurulum biter
bitmez **"anahtarını sohbete yapıştırdın, bunu iptal edip yenisini üretmen
daha güvenli olur"** de.

---

## Akış

### Adım 1 — Neyin kurulu olduğuna bak

```bash
npx -y magaza-mcp durum --json
```

Her mağaza için anahtar var mı, bağlantı çalışıyor mu, hangi istemcilere
kayıtlı — hepsi çıktıda. Anahtarın kendisi **yoktur**; Key ID'nin yalnızca son
dört hanesi görünür.

İkisi de `tamam` dönüyorsa kurulum zaten tamamdır; adım 4'e geç.

### Adım 2 — Anahtarı bul

Kullanıcıya anahtarını sormadan önce **makinesinde ara.** Çoğu zaman zaten
indirmiştir, sadece nerede olduğunu bilmez:

```bash
npx -y magaza-mcp tara --json
```

Alışılmış klasörleri (İndirilenler, Masaüstü, Belgeler, `~/.config`,
`~/.appstoreconnect/private_keys`, bulunduğun proje klasörü) üç seviye derinlikte
tarar, saniyeler sürer. Her bulgu şöyle döner:

```json
{
  "bulgular": [
    { "tur": "appstore", "yol": "/Users/x/Downloads/AuthKey_ABC123DEFG.p8",
      "guven": "yuksek", "key_id": "ABC123DEFG", "degistirilme": "2026-09-20" },
    { "tur": "play", "yol": "/Users/x/.config/play/hesap.json",
      "guven": "yuksek", "servis_hesabi": "yayin@proje.iam.gserviceaccount.com",
      "proje": "proje", "degistirilme": "2026-08-02" }
  ]
}
```

`guven: "dusuk"` olanları kullanıcıya sormadan kullanma — `uyari` alanında
sebebi yazar (StoreKit anahtarı olabilir, Firebase servis hesabı olabilir).

**Kullanıcıya böyle sor** (bulgu varsa):

> Makinende iki anahtar buldum:
> - App Store: `~/Downloads/AuthKey_ABC123DEFG.p8` (Key ID ABC123DEFG, 20 Eylül)
> - Play: `~/.config/play/hesap.json` (yayin@proje.iam.gserviceaccount.com)
>
> Bunları kullanayım mı? Başka bir dosya varsa yolunu söyle, ya da anahtarı
> kopyalayıp bana at — ikisi de olur.

**Hiç bulgu yoksa** kullanıcıya üç seçenek sun:

> Anahtarını bulamadım. Üç yoldan biriyle ilerleyebiliriz:
> 1. Dosyanın yerini biliyorsan yolunu söyle, gerisini ben hallederim.
> 2. Dosyayı panona kopyala, "kopyaladım" de — içeriğini görmeden kaydederim.
> 3. Henüz anahtarın yoksa nereden alacağını adım adım anlatayım.

### Adım 3 — Anahtarı kaydet

Dosya yolunu biliyorsan tek komut. Anahtar önce Apple/Google'a gerçek bir istek
atılarak doğrulanır, geçmezse kasaya **yazılmaz**:

```bash
npx -y magaza-mcp anahtar --apple-p8 "/Users/x/Downloads/AuthKey_ABC123DEFG.p8" \
  --issuer-id 69a6de70-0000-0000-0000-000000000000

npx -y magaza-mcp anahtar --play-json "/Users/x/.config/play/hesap.json"
```

- `--key-id` vermezsen dosya adından okunur (`AuthKey_XXXX.p8`). Okunamazsa
  komut sana söyler, o zaman kullanıcıdan iste.
- `--issuer-id` her zaman gerekir. Gizli değildir; App Store Connect →
  Kullanıcılar ve Erişim → Entegrasyonlar sayfasında anahtar listesinin üstünde
  yazan UUID'dir. Kullanıcıdan istemekte sakınca yok.
- `--json` eklersen makine okunur çıktı alırsın.

**Kullanıcı "sana atayım" derse** anahtarı sohbete yapıştırtma; panosuna
kopyalatıp boru hattından geçir. İçerik senin bağlamına girmeden kasaya gider:

```bash
pbpaste | npx -y magaza-mcp anahtar --play-json -          # macOS
pbpaste | npx -y magaza-mcp anahtar --apple-p8 - --key-id ABC123DEFG --issuer-id <UUID>
```

Linux'ta `xclip -o` veya `wl-paste` kullanılır. Kullanıcı dosyayı bir yere
sürükleyip bıraktıysa (çoğu istemci dosya yolunu mesaja yazar) o yolu doğrudan
`--apple-p8` / `--play-json` ile ver.

Yanlış anahtar verilirse kasadaki eskisi bozulmaz: Apple tarafında doğrulama
yazmadan önce yapılır, Play tarafında başarısızlıkta eski değer geri konur.

### Adım 4 — Sunucuyu istemcilere kaydet

Bu komut kimlik bilgisi istemez, soru sormaz:

```bash
npx -y magaza-mcp kaydet --magazalar appstore,play
```

Kullanıcı tek mağaza kullanıyorsa onu ver — diğerinin araçları hiç yüklenmez:

```bash
npx -y magaza-mcp kaydet --magazalar play
```

Belirli istemcilere yazmak istersen:

```bash
npx -y magaza-mcp kaydet --magazalar appstore,play --istemci claude-code,antigravity
```

Geçerli istemci anahtarları: `claude-code`, `claude-desktop`, `antigravity`,
`cursor`, `windsurf`, `codex`. `--istemci` vermezsen makinede kurulu görünenlere
yazar.

Kullanıcı "hiçbir şeyi değiştirmesin, sadece okusun" diyorsa `--salt-okunur`
ekle (bayrak ayar dosyasına da yazılır):

```bash
npx -y magaza-mcp kaydet --magazalar appstore,play --salt-okunur
```

Bu modda yazma yapan araçlar (`appstore__yorum_yanitla`,
`appstore__metin_guncelle`, `play__yorum_yanitla`) listeye hiç girmez; 27 araç
24'e düşer. `magaza__cagir` listede kalır — katalogdaki okuma uçlarına da o
araçtan gidiliyor — ama veri değiştiren bir operasyon istendiğinde reddeder.

Komut mevcut ayarlara dokunmaz: yalnızca `magaza-mcp` girdisini ekler veya
günceller, her yazmadan önce `.magaza-mcp-yedek` kopyası alır ve yazmayı atomik
yapar.

### Adım 5 — Doğrula ve bitir

```bash
npx -y magaza-mcp durum
```

`✓` görürsen bağlantı çalışıyor. Sonra kullanıcıya **istemcisini yeniden
başlatmasını** söyle — MCP sunucuları yalnızca açılışta yüklenir. Kendi
üzerinde çalıştığın istemciye kurduysan bunu özellikle belirt: sen yeniden
başlatamazsın.

Sık karşılaşılan çıktılar:

- **App Store: anahtar reddedildi** → Key ID, Issuer ID ve `.p8` birbirine ait
  değil, ya da anahtar iptal edilmiş. Sistem saati de kaymış olabilir; imzalı
  token'ın ömrü 20 dakika.
- **Play: "anahtar geçerli, ancak Play Developer Reporting API kapalı"** →
  Anahtar sorunsuz. Yalnızca Cloud projesinde o API açılmamış;
  `play__uygulamalar` ve `play__cokme_orani` bundan etkilenir, diğer Play
  araçları çalışır. Kullanıcıya Cloud Console'dan açmasını önerebilirsin.

---

## Kullanıcının anahtarı hiç yoksa

Bunu ona sen anlatacaksın; linkleri ver, adımları say, sonra Adım 2'ye dön.

**App Store Connect:**
1. [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → Kullanıcılar
   ve Erişim → Entegrasyonlar → App Store Connect API
2. `+` ile anahtar üret. **App Manager rolü yeterlidir**, Admin gerekmez.
3. İnen `.p8` dosyası **yalnızca bir kez** indirilebilir; sakladığı yeri sana
   söylemesini iste.
4. Aynı sayfadaki Issuer ID'yi ve anahtarın Key ID'sini de sana versin.

**Google Play:**
1. [console.cloud.google.com](https://console.cloud.google.com) → servis hesabı
   oluştur → JSON anahtarı indir.
2. Aynı projede **Android Publisher API** ve **Play Developer Reporting API**'yi
   aç.
3. [Play Console](https://play.google.com/console) → Kullanıcılar ve izinler →
   o servis hesabının e-postasını davet et, uygulamalara erişim ver.
4. İzinlerin yayılması birkaç dakika sürebilir; `durum` ilk denemede 403
   derse biraz bekleyip tekrar dene.

---

## Elle kurulum (sen yoksan)

Kullanıcı ajansız ilerlemek isterse bir sihirbaz var — ona bunu sen önerme,
yalnızca kullanıcı isterse söyle:

```bash
npx magaza-mcp kur
```

---

## Kurulumdan sonra: araçları nasıl kullanacaksın

### Yüklü araçlar günlük işi görür

İki mağaza da açıkken 27 araç yüklenir: 11 tane `appstore__`, 10 tane `play__`,
3 tane iki mağazayı birden sorgulayan `magaza__`, 3 tane de aşağıdaki erişim
aracı. Tek mağazalı kurulumda çapraz araçlar hiç oluşmaz: yalnızca App Store'da
14, yalnızca Play'de 13 araç yüklenir. Araç tanımlarının tamamı bağlamda
yaklaşık **4.000 token** yer kaplar.

Hangi araçların yüklü olduğunu `npx -y magaza-mcp araclar` ile görebilirsin.

### Yüklü olmayan her şeye de erişebilirsin

Apple ve Google'ın API'lerinde toplam **1.440 operasyon** var. Bunların hepsini
ayrı araç olarak sunmak yaklaşık 210.000 token tutardı — bu yüzden sunulmuyor.
Bunun yerine:

```
magaza__endpoint_ara(sorgu: "subscription price")   → operasyonu bul
magaza__sema(magaza, operasyon)                     → gövdesi nasıl olmalı
magaza__cagir(magaza, operasyon, parametreler)      → çalıştır
```

Bu üç araç sayesinde kapalı hiçbir özellik yok; kullanılmayanın maliyeti de yok.

**Önemli:** Kullanıcı yüklü araçların kapsamadığı bir şey isterse "bu MCP
bunu yapamıyor" deme — önce `magaza__endpoint_ara` ile ara. Aradığın şey
büyük ihtimalle vardır. Arama Türkçe değil, API terimleriyle yapılır
(`subscription`, `review`, `build`, `crash rate`). Özeti `[ESKİMİŞ]` ile
başlayan operasyonlar Apple'ın artık önermediği uçlardır; güncel bir karşılığı
varsa onu tercih et.

### Veri değiştirirken

Yazma işlemleri `onayla: true` olmadan çalışmaz. Onay istendiğinde araç sana ne
olacağını ve beklenen gövdeyi döndürür. **Kullanıcıya ne yapacağını anlat,
onayını al, sonra tekrar çağır.** Kullanıcı açıkça istemeden `onayla: true`
gönderme.

Fiyat değiştirmek, kullanıcı yetkisi vermek, bir şey silmek ve yayına almak
geri alınması zor işlerdir; bunlarda özellikle dikkatli ol.
