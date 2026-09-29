# Katkı rehberi

Kısa tutuyoruz. Aşağıdakileri yaparsanız yeterli.

## Kurulum

```bash
git clone https://github.com/tunaarikaya/magaza-mcp.git
cd magaza-mcp
npm install
npm run build
npm run kontrol
```

- `npm run build` — TypeScript'i derler ve katalog JSON'larını `dist/` altına kopyalar.
- `npm run kontrol` — `tsc --noEmit`, yani tip kontrolü. PR göndermeden önce temiz geçmeli.
- `npm run dev` — derleyiciyi izleme kipinde çalıştırır.

Node 18 ve üzeri destekleniyor (`package.json` → `engines`); geliştirme için
Node 20 veya 22 önerilir — sürekli tümleştirme bu iki sürümde çalışıyor
(`.github/workflows/ci.yml`).

## Araç eklerken

Yeni araçlar `src/araclar/` altına girer. Oradaki mevcut üsluba uyun:

- **Açıklamalar Türkçe.** Araç açıklaması, parametre açıklaması, hata mesajı —
  kullanıcının ya da modelin gördüğü her metin Türkçe.
- **Alan adları Türkçe.** Parametre ve dönüş alanlarında `magaza`, `onayla`,
  `govde` gibi Türkçe adlar kullanılır; İngilizce karışımı yapmayın.
- **Yorumlar Türkçe.** Dosya başındaki blok yorum aracın ne işe yaradığını
  anlatsın.
- **Veri değiştiren araçlar onay ister.** Yazma yapan bir araç `onayla=true`
  gelmeden işi yürütmemeli, önce ne yapacağını anlatmalı.
- **Salt-okunur modu unutmayın.** Yazma yapan araçlar `yazma: true` ile
  işaretlenir; `--salt-okunur` açıkken bunlar listeden çıkarılır. Tek istisna
  `magaza__cagir`: hem okuma hem yazma uçlarının tek kapısı olduğu için
  listede kalır ve yazma korumasını operasyon bazında kendisi uygular.

## Kataloglar elle düzenlenmez

`src/katalog/appstore.json` ve `src/katalog/play.json` üretilmiş dosyalardır.
Elle düzenlemeyin. `spec/` altındaki Apple ve Google tanımlarını güncelledikten
sonra şunu çalıştırın:

```bash
node scripts/uret-katalog.mjs
```

Üretici betiğin kendisinde (`scripts/uret-katalog.mjs`) değişiklik yapmak
serbesttir; çıktısını elle düzeltmek değil.

`spec/` altındaki dosyalar da elle güncellenmez. Apple ve Google'dan taze
sürümlerini indirip katalogları yeniden üretmek için:

```bash
npm run spec:guncelle
```

Bunu elle yapmaya çoğu zaman gerek yok: `.github/workflows/spec-guncelle.yml`
her pazartesi aynı işi çalıştırıyor ve değişiklik varsa otomatik PR açıyor.

## PR göndermeden önce

- [ ] `npm run kontrol` temiz geçiyor.
- [ ] `npm run build` hatasız tamamlanıyor.
- [ ] Değişiklikte **gerçek kimlik bilgisi yok**: Key ID, Issuer ID, `.p8`
      içeriği, servis hesabı JSON'u, erişim token'ı, gerçek e-posta, gerçek
      paket veya uygulama adı. Örnekler tamamen uydurma olsun.
- [ ] Yerel makinenize özgü mutlak yollar (`/Users/...` gibi) koda veya
      belgeye sızmamış.
- [ ] Yeni metinler Türkçe.

Emin değilseniz `git diff` çıktısını bir kez okuyun; en hızlı kontrol bu.

## Sürüm çıkarma

Yayın elle yapılmaz; `npm publish`'i GitHub Actions çalıştırır. Sebebi
provenance: npm, paketi Actions içinde derlerken Sigstore ile imzalı bir köken
belgesi üretiyor ve npm sayfasında "Provenance" olarak gösteriyor — tarball'ın
gerçekten bu repodaki bu commit'ten üretildiğinin, elle taklit edilemeyen
kanıtı. Kendi makinenden yayınlarsan o mühür olmaz.

```bash
npm version minor -m "Sürüm %s"   # package.json + etiket
git push origin main --follow-tags
```

Etiket itilince `Yayınla` workflow'u çalışır: sürümün etiketle uyuştuğunu
doğrular, tip kontrolü + derleme + testleri koşar, sonra
`npm publish --provenance` ile yayınlar.

### İlk kurulum: NPM_TOKEN

Deponun `NPM_TOKEN` secret'ı olmalı. npm → **Access Tokens → Generate New
Token → Granular Access Token** (eski "Classic / Automation" token türü
kaldırıldı; artık tek seçenek bu). Formda üç şey doğru olmalı:

| Alan | Değer | Yanlışsa ne olur |
|---|---|---|
| **Bypass two-factor authentication (2FA)** | işaretli | CI tek kullanımlık şifre ister, yayın `EOTP` ile düşer |
| **Permissions** | `Read and write (publish and stage)` | `npm error 404 PUT` |
| **Select packages** | `All packages` ya da `magaza-mcp` seçili | `npm error 404 PUT` |

`404 PUT` hatası "paket yok" demek değildir: npm, paketin varlığını
sızdırmamak için yetkisiz yayın denemelerine de 404 döner. Yani o hatayı
görüyorsan token geçerlidir, sadece yazma yetkisi yoktur.

Token'ı secret'a yazarken içeriğini bir yere yapıştırma, panodan boru ile geçir:

```bash
pbpaste | gh secret set NPM_TOKEN -R tunaarikaya/magaza-mcp
```

> `gh secret set`'i TTY olmayan bir kabuktan (örneğin bir yapay zekâ ajanının
> içinden) argümansız çalıştırırsan **hiçbir şey sormaz ve secret'ı boş
> kaydeder.** Sonraki yayın `ENEEDAUTH` ile düşer. Workflow artık bunu en
> baştan yakalayıp açıkça söylüyor.

## Hata ve öneriler

Hata bildirimi ve özellik isteği için issue formlarını kullanın. Güvenlik
açıkları issue'ya yazılmaz — [SECURITY.md](SECURITY.md) dosyasına bakın.
