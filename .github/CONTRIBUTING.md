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

## Hata ve öneriler

Hata bildirimi ve özellik isteği için issue formlarını kullanın. Güvenlik
açıkları issue'ya yazılmaz — [SECURITY.md](SECURITY.md) dosyasına bakın.
