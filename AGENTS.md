# Yapay zekâ ajanları için kurulum talimatı

Bu dosya, `magaza-mcp`'yi bir kullanıcı adına kuran yapay zekâ ajanları içindir
(Claude Code, Antigravity, Cursor, Codex, Gemini CLI ve benzerleri).

Kullanıcı sana bu reponun linkini verdiyse yapman gereken aşağıda.
**Tamamını oku, sonra sırayla uygula.**

---

## Altın kural: özel anahtarı sen görmeyeceksin

İş bölümü nettir:

| Kim | Ne yapar |
|---|---|
| **Sen (ajan)** | Sunucuyu istemcilerin ayar dosyalarına kaydedersin, durumu doğrularsın |
| **Kullanıcı** | Anahtarı kendisi girer: `npx magaza-mcp kur` |

Kullanıcıdan Key ID, Issuer ID, `.p8` dosyasının içeriği veya servis hesabı
JSON'u **isteme**. Bu dosyaları okuma, terminale bastırma, başka bir dosyaya
kopyalama. Anahtarlar kullanıcının Anahtar Zinciri'nde durur ve senin
bağlamına hiç girmemelidir — bir kez bağlamına girerse oturum kaydına,
günlüklere ve özetlere sızar.

Kullanıcı ısrar edip anahtarı yapıştırırsa: kullanma, kaydetme, "anahtarını
sohbete yapıştırdın, bunu iptal edip yenisini üretmen daha güvenli olur" de.

---

## Adım 1 — Neyin kurulu olduğuna bak

```bash
npx -y magaza-mcp durum --json
```

Sana şunu döndürür: her mağaza için anahtar var mı, bağlantı çalışıyor mu,
hangi istemcilere kayıtlı. Anahtarın kendisi çıktıda **yoktur**; yalnızca
Key ID'nin son dört hanesi görünür.

## Adım 2 — Sunucuyu kaydet

Bu komut kimlik bilgisi istemez, soru sormaz, hiçbir şey okumaz:

```bash
npx -y magaza-mcp kaydet --magazalar appstore,play
```

Kullanıcı yalnızca bir mağaza kullanıyorsa onu ver — diğerinin araçları hiç
yüklenmez:

```bash
npx -y magaza-mcp kaydet --magazalar play
```

Belirli istemcilere yazmak istersen:

```bash
npx -y magaza-mcp kaydet --magazalar appstore,play --istemci claude-code,antigravity
```

Geçerli istemci anahtarları: `claude-code`, `claude-desktop`, `antigravity`,
`cursor`, `windsurf`, `codex`. `--istemci` vermezsen makinede kurulu
görünenlere yazar.

Kullanıcı "hiçbir şeyi değiştirmesin, sadece okusun" diyorsa
`--salt-okunur` ekle; veri değiştiren araçlar tamamen yüklenmez.

Komut mevcut ayarlara dokunmaz: yalnızca `magaza-mcp` girdisini ekler veya
günceller, her yazmadan önce `.magaza-mcp-yedek` kopyası alır ve yazmayı
atomik yapar.

## Adım 3 — Anahtarı kullanıcıya girdirt

Bunu sen yapmıyorsun. Kullanıcıya **aynen** şunu söyle:

> Şimdi anahtarını girmen gerekiyor. Terminale şunu yaz:
>
> ```
> npx magaza-mcp kur
> ```
>
> Sihirbaz hangi mağazaları bağlayacağını sorar, sonra anahtarını ister.
> Anahtarın bilgisayarından çıkmaz, ben de görmem.

İhtiyaç duyacağı şeyler:

- **App Store Connect:** App Store Connect → Kullanıcılar ve Erişim →
  Entegrasyonlar → Anahtar üret. **App Manager rolü yeterlidir**, Admin
  gerekmez. İndirilen `.p8` dosyası bir kez indirilebilir, saklaması gerekir.
- **Google Play:** Google Cloud Console'da bir servis hesabı ve JSON anahtarı;
  ardından Play Console → Kullanıcılar ve izinler'den o servis hesabını davet
  etmesi gerekir. Cloud projesinde **Android Publisher API** ve **Play
  Developer Reporting API** açık olmalı.

## Adım 4 — Doğrula

```bash
npx -y magaza-mcp durum
```

`✓` görürsen bağlantı çalışıyor. Sonra kullanıcıya istemcisini yeniden
başlatmasını söyle — MCP sunucuları yalnızca açılışta yüklenir.

Sık karşılaşılan iki çıktı:

- **App Store: anahtar reddedildi** → Key ID, Issuer ID ve `.p8` birbirine ait
  değil, ya da anahtar iptal edilmiş. Sistem saati de kaymış olabilir; imzalı
  token'ın ömrü 20 dakika.
- **Play: Reporting API kapalı** → Anahtar geçerli, sadece Cloud projesinde o
  API açılmamış. `play__uygulamalar` ve `play__cokme_orani` bundan etkilenir,
  diğer Play araçları çalışmaya devam eder.

---

## Kurulumdan sonra: araçları nasıl kullanacaksın

### Yüklü araçlar günlük işi görür

İki mağaza da açıkken 27 araç yüklenir: 11 tane `appstore__`, 10 tane `play__`,
3 tane iki mağazayı birden sorgulayan `magaza__`, 3 tane de aşağıdaki erişim
aracı. Araç tanımlarının tamamı bağlamda yaklaşık **3.500 token** yer kaplar.

### Yüklü olmayan her şeye de erişebilirsin

Apple ve Google'ın API'lerinde toplam **1.281 operasyon** var. Bunların hepsini
ayrı araç olarak sunmak yaklaşık 184.000 token tutardı — bu yüzden sunulmuyor.
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
(`subscription`, `review`, `build`, `crash rate`).

### Veri değiştirirken

Yazma işlemleri `onayla: true` olmadan çalışmaz. Onay istendiğinde araç sana ne
olacağını ve beklenen gövdeyi döndürür. **Kullanıcıya ne yapacağını anlat,
onayını al, sonra tekrar çağır.** Kullanıcı açıkça istemeden `onayla: true`
gönderme.

Fiyat değiştirmek, kullanıcı yetkisi vermek, bir şey silmek ve yayına almak
geri alınması zor işlerdir; bunlarda özellikle dikkatli ol.
