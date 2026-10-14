/**
 * İnceleme geçmişi & hesap kuralları — saf, ağsız.
 *
 * Alan adları ve enum'lar spec/appstore-openapi.json'a karşı doğrulandı
 * (AgeRatingDeclaration, TerritoryAvailability.contentStatuses).
 */
import type { Istek } from "../../../istemci/apple.js";
import { bulguId, type Bulgu, type Duzeltme, type Uygulama, type Veri } from "../tip.js";

const GUN = 86_400_000;
const DEGER = "<senin değerin>";
const SURUM_YOK = "Düzenlenebilir sürüm yok — App Store Connect'te yeni sürüm aç, sonra tekrar dene.";

const RED_SURUM = new Set(["REJECTED", "METADATA_REJECTED", "INVALID_BINARY"]);
const BEKLEYEN = new Set(["WAITING_FOR_REVIEW", "IN_REVIEW"]);
const YAYINDA = new Set(["READY_FOR_DISTRIBUTION", "READY_FOR_SALE"]);
const TRADER = new Set(["TRADER_STATUS_NOT_PROVIDED", "TRADER_STATUS_VERIFICATION_FAILED", "TRADER_STATUS_VERIFICATION_STATUS_MISSING"]);
/** Satışı engellemeyen durumlar; geri kalan her şey bir engeldir. */
const OLUMLU = new Set([
  "AVAILABLE",
  "AVAILABLE_FOR_PREORDER",
  "AVAILABLE_FOR_PREORDER_ON_DATE",
  "AVAILABLE_FOR_SALE_UNRELEASED_APP",
  "PREORDER_ON_UNRELEASED_APP",
  "PROCESSING_TO_AVAILABLE",
  "PROCESSING_TO_PRE_ORDER",
  "PROCESSING_TO_NOT_AVAILABLE",
]);
/** 2026'da zorunlu olan yeni yaş anketi soruları. */
const YENI_YAS_SORULARI = [
  "ageAssurance",
  "advertising",
  "healthOrWellnessTopics",
  "messagingAndChat",
  "parentalControls",
  "userGeneratedContent",
];

const MARKALAR = [
  "marvel", "disney", "pixar", "pokemon", "pokémon", "naruto", "one piece", "dragon ball", "anime",
  "netflix", "nba", "nfl", "fifa", "uefa", "harry potter", "star wars", "minecraft", "fortnite",
];
const SIFRELEME = ["vpn", "encrypted", "encryption", "end-to-end", "e2e", "şifreli", "şifreleme", "uçtan uca"];
// "poker", "bet", "slot" tek başına sayılmaz: "poker face", parti oyunları yanlış alarm veriyordu.
const KUMAR = [
  "casino", "kumar", "kumarhane", "bahis", "betting", "sports betting", "slot machine", "slots", "jackpot",
  "roulette", "rulet", "blackjack",
];
// "account"/"hesap" tek başına sayılmaz: abonelik metinlerindeki "charged to your Apple ID account" tetikliyordu.
// Türkçe kalıplarda sağ sınır yok — "giriş yapın", "kayıt olun" gibi ekler de yakalansın.
const GIRIS =
  /(?<![\p{L}\p{N}])(?:(?:log ?in|sign ?in|sign ?up|create an account)(?![\p{L}\p{N}])|giriş yap|oturum aç|kayıt ol|hesap oluştur|üye ol)/iu;

/** Harf/rakam sınırına duyarlı arama — `\b` Türkçe harflerde çalışmaz. */
function bulunanlar(metin: string, liste: string[]): string[] {
  return liste.filter((k) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu").test(metin),
  );
}

function tumMetin(u: Uygulama): string {
  return [
    u.ad,
    ...u.bilgiler.flatMap((b) => b.yerel.flatMap((y) => [y.ad, y.altBaslik])),
    ...u.surumYerel.flatMap((y) => [y.anahtarKelimeler, y.aciklama]),
  ]
    .filter(Boolean)
    .join("\n");
}

const gunFarki = (simdi: string, tarih: string) => (Date.parse(simdi) - Date.parse(tarih)) / GUN;
const kim = (u: Uygulama) => ({ id: u.id, ad: u.ad });

function evetHayir(deger?: string): boolean {
  const s = String(deger ?? "").trim().toLocaleLowerCase("tr");
  if (["evet", "e", "yes", "y", "true"].includes(s)) return true;
  if (["hayır", "hayir", "h", "no", "n", "false"].includes(s)) return false;
  throw new Error("Değer 'evet' ya da 'hayır' olmalı.");
}

function redSayisi(u: Uygulama, simdi: string): number {
  const yakin = (t?: string) => !t || gunFarki(simdi, t) <= 365;
  return (
    u.surumler.filter((s) => (RED_SURUM.has(s.durum) || RED_SURUM.has(s.magazaDurumu ?? "")) && yakin(s.olusturma)).length +
    u.gonderimler.filter((g) => g.durum === "UNRESOLVED_ISSUES" && yakin(g.tarih)).length
  );
}

/** İnceleme detayına yazan istek: kayıt varsa PATCH, yoksa hedef sürüme bağlı POST. */
function incelemeDetayiIstegi(u: Uygulama, ozellikler: Record<string, unknown>): Istek {
  if (u.incelemeDetayi?.id) {
    return {
      yontem: "PATCH",
      yol: `/v1/appStoreReviewDetails/${encodeURIComponent(u.incelemeDetayi.id)}`,
      govde: { data: { type: "appStoreReviewDetails", id: u.incelemeDetayi.id, attributes: ozellikler } },
    };
  }
  return {
    yontem: "POST",
    yol: "/v1/appStoreReviewDetails",
    govde: {
      data: {
        type: "appStoreReviewDetails",
        attributes: ozellikler,
        relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: u.hedefSurumId } } },
      },
    },
  };
}

const surumEngeli = (u: Uygulama) => (u.hedefSurumDuzenlenebilir && u.hedefSurumId ? undefined : SURUM_YOK);

export function incelemeHesapKurallari(v: Veri): Bulgu[] {
  const out: Bulgu[] = [];
  let hesapRed = 0;

  for (const u of v.uygulamalar) {
    const uygulama = kim(u);
    const metin = tumMetin(u);

    // red-gecmisi
    const red = redSayisi(u, v.simdi);
    hesapRed += red;
    if (red >= 3) {
      out.push({
        id: bulguId("red-gecmisi", u.id),
        kural: "red-gecmisi",
        ciddiyet: red >= 5 ? "yuksek" : "orta",
        uygulama,
        baslik: `Son 12 ayda ${red} red / çözülmemiş inceleme sorunu var.`,
        neden:
          "Sık red alan uygulamaların sonraki gönderimleri daha dikkatli ve yavaş incelenebilir. Asıl risk, aynı " +
          "sorunla tekrar tekrar göndermek (4.3(b)).",
        kanit: { red_sayisi: red },
        adimlar: [
          "App Store Connect → Uygulama → Resolution Center'da her red gerekçesini oku.",
          "Gerekçeyi gerçekten düzelt; sonra red mesajına kısa ve olgusal cevap ver (ne değişti) — bu normal akış, göze batmaz.",
        ],
        yapma: [
          "Aynı şeyi değiştirmeden tekrar gönderme.",
          "İlk refleks olarak App Review Board'a itiraz etme — yalnızca açık bir yanlış anlama varsa ve düzeltmek mümkün değilse.",
          "Redde Apple'la tartışma, uzun savunma yazma.",
        ],
      });
    }

    // uzun-bekleyen-inceleme — en eski bekleyen gönderim
    const bekleyen = u.gonderimler
      .filter((g) => BEKLEYEN.has(g.durum) && g.tarih)
      .map((g) => ({ g, gun: gunFarki(v.simdi, g.tarih!) }))
      .sort((a, b) => b.gun - a.gun)[0];
    if (bekleyen && bekleyen.gun > 3) {
      const gun = Math.floor(bekleyen.gun);
      out.push({
        id: bulguId("uzun-bekleyen-inceleme", u.id, bekleyen.g.id),
        kural: "uzun-bekleyen-inceleme",
        ciddiyet: bekleyen.gun > 7 ? "yuksek" : "orta",
        uygulama,
        baslik: `İnceleme ${gun} gündür bekliyor (normali 1-2 gün).`,
        neden:
          "Bu bir hüküm değil, sinyal: uzun bekleme bazen hesabın genişletilmiş incelemeye alındığını gösterir. " +
          "Apple'ın o durumdaki mesajı: \"We need additional time to evaluate your submission and Apple Developer " +
          "Program account.\" Nominal süre 7 iş günü; çoğu zaman kendiliğinden sonuçlanır.",
        kanit: { gonderim: bekleyen.g.id, durum: bekleyen.g.durum, gonderilme: bekleyen.g.tarih, gun },
        adimlar: [
          "Bekle; gönderime dokunma.",
          "Apple bir şey sorarsa (Resolution Center / e-posta) 24 saat içinde kısa ve olgusal cevap ver.",
          "Bekleme sürerken diğer uygulamalarını normal akışında tut; ani toplu gönderim yapma.",
          "Hesapta açık risk sinyalleri varsa (bu rapordaki kritik/yüksek bulgular) onları bir sonraki sürümlerde sessizce düzelt.",
        ],
        yapma: [
          "Gönderimi iptal edip yeniden gönderme — sırayı sıfırlar.",
          "App Review'a 'neden bu kadar uzun' diye form doldurma, şikâyet etme ya da hızlandırma (expedite) isteme — dikkat çeker.",
          "Yeni hesap açma, uygulamayı başka hesaba taşıma.",
        ],
      });
    }

    // apple-kaldirdi
    if (u.surumler.some((s) => s.magazaDurumu === "REMOVED_FROM_SALE")) {
      out.push({
        id: bulguId("apple-kaldirdi", u.id),
        kural: "apple-kaldirdi",
        ciddiyet: "kritik",
        uygulama,
        baslik: "Uygulama Apple tarafından satıştan kaldırılmış.",
        neden:
          "Apple'ın kaldırdığı uygulamalar hesabın sicilinde kalır; birkaç tane birikirse hesap kapatma " +
          "incelemesine girer. Sebep çözülmezse diğer uygulamalarına da sıçrayabilir.",
        kanit: { surumler: u.surumler.filter((s) => s.magazaDurumu === "REMOVED_FROM_SALE").map((s) => s.surum) },
        adimlar: [
          "Apple'dan gelen kaldırma e-postasını ve Resolution Center'ı oku, gerekçeyi öğren.",
          "Gerekçeyi düzelt; düzeltilmiş sürümle Resolution Center'dan kısa ve olgusal yanıt ver — Apple zaten işlem yaptığı için burada iletişim meşru.",
          "App Review Board'a yalnızca gerekçe açıkça yanlışsa başvur.",
        ],
        yapma: [
          "Aynı uygulamayı yeni isimle ya da başka hesaptan yeniden yükleme — 4.3 spam ve bağlantılı hesap sayılır.",
          "Yeni hesap açma.",
        ],
      });
    }

    // eski-uygulama
    const canli = u.surumler
      .filter((s) => YAYINDA.has(s.durum) || YAYINDA.has(s.magazaDurumu ?? ""))
      .sort((a, b) => Date.parse(b.olusturma) - Date.parse(a.olusturma))[0];
    if (canli) {
      const yil = gunFarki(v.simdi, canli.olusturma) / 365;
      if (yil > 2) {
        out.push({
          id: bulguId("eski-uygulama", u.id),
          kural: "eski-uygulama",
          ciddiyet: yil > 3 ? "orta" : "dusuk",
          uygulama,
          baslik: `Yayındaki sürüm ${Math.floor(yil)} yıldır güncellenmemiş.`,
          neden:
            "Apple 'App Store Improvements' kapsamında uzun süre güncellenmeyen uygulamalara 90 günlük uyarı " +
            "gönderir; güncellenmezse uygulama mağazadan kaldırılır.",
          kanit: { surum: canli.surum, olusturma: canli.olusturma },
          adimlar: [
            "Güncel Xcode/SDK ile yeni bir build alıp küçük de olsa normal bir güncelleme yayımla.",
            "Uygulamayı artık sürdürmeyeceksen kendin satıştan kaldır.",
          ],
          yapma: ["Apple'ın uyarı e-postasını beklemeden 'güncelleyeceğim' diye Apple'a yazma — güncellemeyi yayımlamak yeter."],
        });
      }
    }

    // isim-isgali
    if (
      u.surumler.length &&
      u.surumler.every((s) => s.durum === "PREPARE_FOR_SUBMISSION") &&
      !u.buildler.length
    ) {
      const enEski = Math.max(...u.surumler.map((s) => gunFarki(v.simdi, s.olusturma)));
      if (enEski > 90) {
        out.push({
          id: bulguId("isim-isgali", u.id),
          kural: "isim-isgali",
          ciddiyet: "orta",
          uygulama,
          baslik: `${Math.floor(enEski)} gündür hiç build yüklenmemiş, hiç yayımlanmamış uygulama kaydı.`,
          neden:
            "DPLA 3.2(f) uygulama ismini kullanmadan tutmayı ('squatting') yasaklar; Apple böyle kayıtları silebilir.",
          kanit: { ilk_kayit_gun: Math.floor(enEski) },
          adimlar: [
            "Yakında yayımlamayacaksan kaydı App Store Connect'ten sil (Uygulama Bilgileri → Uygulamayı Kaldır).",
            "Yayımlayacaksan bir build yükleyip normal şekilde incelemeye gönder.",
          ],
          yapma: ["Aynı ismi tutmak için yeni boş kayıtlar açma."],
        });
      }
    }

    // trader-durumu / bolge-engeli
    const trader = Object.entries(u.bolgeDurumlari).filter(([d]) => TRADER.has(d));
    if (trader.length) {
      out.push({
        id: bulguId("trader-durumu", u.id),
        kural: "trader-durumu",
        ciddiyet: "yuksek",
        uygulama,
        baslik: "AB tacir (trader) durumu eksik ya da doğrulanmamış.",
        neden:
          "AB Dijital Hizmetler Yasası gereği 17 Şubat 2025'ten beri tacir durumu bildirilmeyen uygulamalar " +
          "AB'deki tüm mağazalardan kaldırılıyor.",
        kanit: Object.fromEntries(trader.map(([d, ulkeler]) => [d, ulkeler.length])),
        adimlar: [
          "App Store Connect → İş (Business) → Digital Services Act formunu doldur (zorunlu bir form, ek yazışma gerekmez).",
          "Tacirsen adres, telefon ve e-postayı doğrulat; doğrulama başarısızsa bilgileri düzeltip formu yeniden gönder.",
        ],
        yapma: ["Formu doldurmak yerine Apple'a e-posta ya da destek talebi açma."],
      });
    }
    // Hiç yayına çıkmamış uygulama her ülkede genel CANNOT_SELL alır — bu normal, engel değil.
    const engeller = canli
      ? Object.entries(u.bolgeDurumlari).filter(
          ([d, ulkeler]) => !OLUMLU.has(d) && !TRADER.has(d) && d !== "CANNOT_SELL" && ulkeler.length,
        )
      : [];
    if (engeller.length) {
      const yalnizCin = engeller.every(([, ulkeler]) => ulkeler.every((k) => k === "CHN"));
      out.push({
        id: bulguId("bolge-engeli", u.id),
        kural: "bolge-engeli",
        ciddiyet: yalnizCin ? "dusuk" : "orta",
        uygulama,
        baslik: `${engeller.length} farklı sebeple bazı ülkelerde satış engelli.`,
        neden: "Bu ülkelerde uygulama görünmez ya da satılamaz; eksik derecelendirme/belge düzeltilmezse kalıcıdır.",
        kanit: Object.fromEntries(
          engeller.map(([d, ulkeler]) => [d, { ulke_sayisi: ulkeler.length, ornek: ulkeler.slice(0, 5) }]),
        ),
        adimlar: [
          "App Store Connect → Fiyatlandırma ve Erişilebilirlik → ülke listesinde uyarı veren ülkelere bak.",
          "MISSING_RATING / GRN / ICP gibi eksik belgeleri ilgili ekrandan tamamla; belgen yoksa o ülkeyi satış listesinden çıkar.",
        ],
        yapma: ["Belgesi gerektiren ülkede (ör. Çin oyun lisansı) belgesiz satış için Apple'a istisna isteme."],
      });
    }

    // icerik-hakki-yok
    if (u.icerikHaklari == null) {
      out.push({
        id: bulguId("icerik-hakki-yok", u.id),
        kural: "icerik-hakki-yok",
        ciddiyet: "dusuk",
        uygulama,
        baslik: "Üçüncü taraf içerik beyanı (Content Rights) boş.",
        neden: "Beyan olmadan gönderim takılır; doğru yanıtlamak yeterli.",
        kanit: { contentRightsDeclaration: null },
        adimlar: ["App Store Connect → Uygulama Bilgileri → İçerik Hakları sorusunu gerçeğe uygun yanıtla."],
        yapma: ["Emin değilsen 'kullanmıyorum' deme — lisanslı müzik, font, görsel de üçüncü taraf içeriktir."],
        duzeltme: {
          gerekenDeger: "üçüncü taraf içerik kullanıyor musun? evet/hayır",
          degisim: [{ alan: "contentRightsDeclaration", simdi: null, yeni: DEGER }],
          istekler: (deger) => [
            {
              yontem: "PATCH",
              yol: `/v1/apps/${encodeURIComponent(u.id)}`,
              govde: {
                data: {
                  type: "apps",
                  id: u.id,
                  attributes: {
                    contentRightsDeclaration: evetHayir(deger) ? "USES_THIRD_PARTY_CONTENT" : "DOES_NOT_USE_THIRD_PARTY_CONTENT",
                  },
                },
              },
            },
          ],
        },
      });
    }

    // sifreleme-beyani-yok — yalnız en son VALID build; eski build'lerdeki boşluk önemsiz.
    const sonGecerli = u.buildler
      .filter((b) => b.durum === "VALID")
      .sort((a, b) => Date.parse(b.yuklenme) - Date.parse(a.yuklenme))[0];
    const beyansiz = sonGecerli?.sifreleme === null ? [sonGecerli] : [];
    if (beyansiz.length) {
      out.push({
        id: bulguId("sifreleme-beyani-yok", u.id),
        kural: "sifreleme-beyani-yok",
        ciddiyet: "dusuk",
        uygulama,
        baslik: `Son build'de (${sonGecerli.surum}) şifreleme (ihracat uyumu) beyanı yok.`,
        neden: "Beyansız build TestFlight'a ve incelemeye gönderilemez; her seferinde elle sorulur.",
        kanit: { buildler: beyansiz.map((b) => b.surum) },
        adimlar: [
          "Bir sonraki build için Info.plist'e ITSAppUsesNonExemptEncryption ekle (yalnızca HTTPS kullanıyorsan false).",
          "Mevcut build için App Store Connect → TestFlight'ta beyanı yanıtla.",
        ],
        yapma: ["Uygulama gerçekten kendi şifrelemesini (VPN, E2E) kullanıyorsa 'hayır' deme."],
        duzeltme: {
          gerekenDeger: "standart dışı şifreleme kullanıyor musun? evet/hayır (çoğu uygulama: hayır — yalnızca HTTPS)",
          degisim: beyansiz.map((b) => ({ alan: `build ${b.surum} usesNonExemptEncryption`, simdi: null, yeni: DEGER })),
          istekler: (deger) => {
            const evet = evetHayir(deger);
            return beyansiz.map((b) => ({
              yontem: "PATCH",
              yol: `/v1/builds/${encodeURIComponent(b.id)}`,
              govde: { data: { type: "builds", id: b.id, attributes: { usesNonExemptEncryption: evet } } },
            }));
          },
        },
      });
    }

    // demo-hesap-eksik
    const detay = u.incelemeDetayi;
    const demoBos = !!detay?.demoGerekli && (!detay.demoAd || !detay.demoSifre);
    const girisVar = u.surumYerel.some((y) => GIRIS.test(y.aciklama ?? ""));
    if (demoBos || (girisVar && !detay?.demoGerekli)) {
      const duzeltme: Duzeltme = {
        gerekenDeger: "demo hesap kullanıcı:şifre",
        engel: surumEngeli(u),
        degisim: [
          { alan: "demoAccountRequired", simdi: detay?.demoGerekli ?? null, yeni: true },
          // DEGER değil: duzelt.ts yer tutucuyu "kullanıcı:şifre" ile değiştirir, şifre önizlemeye sızar.
          { alan: "demoAccountName", simdi: detay?.demoAd ?? null, yeni: "(verdiğin kullanıcı adı)" },
          { alan: "demoAccountPassword", simdi: detay?.demoSifre ? "••••••" : null, yeni: "••••••" },
        ],
        istekler: (deger) => {
          const s = String(deger ?? "");
          const i = s.indexOf(":");
          const ad = i > 0 ? s.slice(0, i).trim() : "";
          const sifre = i > 0 ? s.slice(i + 1) : "";
          if (!ad || !sifre) throw new Error("Demo hesap 'kullanıcı:şifre' biçiminde olmalı.");
          return [incelemeDetayiIstegi(u, { demoAccountRequired: true, demoAccountName: ad, demoAccountPassword: sifre })];
        },
      };
      out.push({
        id: bulguId("demo-hesap-eksik", u.id),
        kural: "demo-hesap-eksik",
        ciddiyet: demoBos ? "orta" : "dusuk",
        uygulama,
        baslik: demoBos
          ? "Demo hesap gerekli işaretli ama kullanıcı adı/şifre boş."
          : "Açıklamada giriş/hesap geçiyor ama inceleme için demo hesap verilmemiş.",
        neden:
          "İnceleyici giriş yapamazsa uygulamayı 2.1 (eksik uygulama) ile reddeder; gereksiz red geçmişi birikir.",
        kanit: { demo_gerekli: detay?.demoGerekli ?? null, aciklamada_giris: girisVar },
        adimlar: [
          "Çalışan, süresi dolmayan bir demo hesap oluştur (gerekiyorsa örnek veriyle doldur).",
          "Bir sonraki gönderimde App Store Connect → Sürüm → App Review Bilgileri → 'Oturum açma gerekli' alanına gir.",
        ],
        yapma: ["Süresi dolan, 2FA isteyen ya da boş bir demo hesap verme — red sebebi olur."],
        duzeltme,
      });
    }

    // inceleme-notu-bos
    if (u.hedefSurumDuzenlenebilir) {
      const not = (detay?.notlar ?? "").trim();
      const sablon = /^(bug fixes( and (performance )?improvements)?|n\/a|none|test|-)\.?$/i.test(not);
      if (!not || not.length < 20 || sablon) {
        out.push({
          id: bulguId("inceleme-notu-bos", u.id),
          kural: "inceleme-notu-bos",
          ciddiyet: red > 0 ? "orta" : "dusuk",
          uygulama,
          baslik: not ? `İnceleme notu şablon/çok kısa: "${not}".` : "İnceleme notu boş.",
          neden:
            "2.3.1(a) yeni özelliklerin inceleme notunda anlatılmasını ister; boş not gereksiz soru ve redlere yol açar.",
          kanit: { notlar: not || null },
          adimlar: [
            "Bu sürümde ne değiştiğini ve nasıl test edileceğini kısa ve olgusal yaz; gerekiyorsa donanım/hesap bilgisini ekle.",
            "Ödeme, abonelik ya da uzaktan yapılandırılan özellikler varsa nerede olduklarını belirt.",
          ],
          yapma: [
            "İnceleme notunda geçmiş sorunları, eski ihlalleri ya da 'şunu kaldırdık' açıklamalarını itiraf etme — not yalnızca bu sürümü anlatır.",
          ],
          duzeltme: {
            gerekenDeger: "inceleme notu (yeni özellikleri ve nasıl test edileceğini açıkça yaz)",
            engel: surumEngeli(u),
            degisim: [{ alan: "notes", simdi: not || null, yeni: DEGER }],
            istekler: (deger) => {
              const yeni = String(deger ?? "").trim();
              if (yeni.length < 20) throw new Error("İnceleme notu en az 20 karakter olmalı.");
              return [incelemeDetayiIstegi(u, { notes: yeni })];
            },
          },
        });
      }
    }

    // yanlis-beyan
    const beyanUyarisi =
      "Beyanla metin çelişirse Apple bunu 'App Store Connect'te yanıltıcı yanıt' sayabilir. Çözümü basit: " +
      "beyanı bir sonraki sürümde gerçeğe uygun hale getirmek.";
    const beyanYapma = [
      "Beyanı düzeltirken Apple'a ayrıca açıklama ya da özür yazma.",
      "Metindeki kelimeyi silip beyanı yanlış bırakma — sorun kelime değil, beyanın gerçeğe uymaması.",
    ];
    const markalar = u.icerikHaklari === "DOES_NOT_USE_THIRD_PARTY_CONTENT" ? bulunanlar(metin, MARKALAR) : [];
    if (markalar.length) {
      out.push({
        id: bulguId("yanlis-beyan", u.id, "icerik"),
        kural: "yanlis-beyan",
        ciddiyet: "orta",
        uygulama,
        baslik: "'Üçüncü taraf içerik yok' beyanı var ama metinde tanınmış marka/eser geçiyor.",
        neden: beyanUyarisi,
        kanit: { beyan: u.icerikHaklari, kelimeler: markalar },
        adimlar: [
          "Bu içeriği lisansla kullanıyorsan bir sonraki sürümde İçerik Hakları beyanını 'kullanıyorum' yap; lisansı kendinde sakla.",
          "Lisansın yoksa marka/eser adlarını ve ilgili içeriği bir sonraki sürümde uygulamadan ve metinlerden çıkar.",
        ],
        yapma: beyanYapma,
      });
    }
    const sonBuild = [...u.buildler].sort((a, b) => Date.parse(b.yuklenme) - Date.parse(a.yuklenme))[0];
    const sifreKelime = sonBuild?.sifreleme === false ? bulunanlar(metin, SIFRELEME) : [];
    if (sifreKelime.length) {
      out.push({
        id: bulguId("yanlis-beyan", u.id, "sifreleme"),
        kural: "yanlis-beyan",
        ciddiyet: "yuksek",
        uygulama,
        baslik: "Build 'standart dışı şifreleme yok' diyor ama metin VPN/şifreleme vaat ediyor.",
        neden: beyanUyarisi + " Şifreleme beyanı ayrıca ABD ihracat mevzuatına tabidir.",
        kanit: { build: sonBuild!.surum, usesNonExemptEncryption: false, kelimeler: sifreKelime },
        adimlar: [
          "Uygulama kendi şifrelemesini (VPN protokolü, E2E) kullanıyorsa bir sonraki build'de beyanı 'evet' yap ve ihracat formunu doldur.",
          "Yalnızca HTTPS kullanıyorsan metindeki şifreleme vaatlerini bir sonraki sürümde gerçeğe uygun hale getir.",
        ],
        yapma: beyanYapma,
      });
    }
    const yas = u.yasBeyani?.ozellikler;
    const kumarBeyanYok =
      !!yas && yas.gambling !== true && (yas.gamblingSimulated == null || yas.gamblingSimulated === "NONE");
    const kumarKelime = kumarBeyanYok ? bulunanlar(metin, KUMAR) : [];
    if (kumarKelime.length) {
      out.push({
        id: bulguId("yanlis-beyan", u.id, "kumar"),
        kural: "yanlis-beyan",
        ciddiyet: "yuksek",
        uygulama,
        baslik: "Yaş anketinde kumar yok denmiş ama metinde casino/bahis geçiyor.",
        neden: beyanUyarisi + " Yaş derecelendirmesi içerikle uyuşmazsa uygulama reddedilebilir ya da kaldırılabilir.",
        kanit: { gambling: yas!.gambling ?? null, gamblingSimulated: yas!.gamblingSimulated ?? null, kelimeler: kumarKelime },
        adimlar: [
          "Simüle kumar varsa yaş anketinde 'Simulated Gambling' sorusunu doğru yanıtla (appstore__yas_derecelendirme).",
          "Gerçek parayla kumar varsa lisans, bölge kısıtı ve organizasyon hesabı gerekir (5.3.3).",
          "Uygulamada kumar içeriği hiç yoksa yalnızca yanıltıcı kelimeleri metinden çıkar.",
        ],
        yapma: beyanYapma,
      });
    }

    // yas-anketi-eksik
    if (yas) {
      const eksik = YENI_YAS_SORULARI.filter((k) => yas[k] == null);
      if (eksik.length) {
        out.push({
          id: bulguId("yas-anketi-eksik", u.id),
          kural: "yas-anketi-eksik",
          ciddiyet: "orta",
          uygulama,
          baslik: `Yaş anketinin 2026'da zorunlu olan ${eksik.length} yeni sorusu boş.`,
          neden: "31 Ocak 2026'dan beri yeni yaş soruları yanıtlanmadan yeni sürüm gönderilemiyor.",
          kanit: { bos_alanlar: eksik },
          adimlar: [
            "Bir sonraki gönderimden önce appstore__yas_derecelendirme aracıyla eksik soruları yanıtla (ya da App Store Connect → Yaş Derecelendirmesi).",
          ],
          yapma: ["Soruları hızlıca geçmek için hepsine 'hayır' deme — içerikle uyuşmayan yanıt yanlış beyan sayılır."],
        });
      }
    }
  }

  // Hesap düzeyi
  if (hesapRed >= 8) {
    out.push({
      id: bulguId("red-gecmisi"),
      kural: "red-gecmisi",
      ciddiyet: "yuksek",
      baslik: `Hesap genelinde son 12 ayda ${hesapRed} red var.`,
      neden:
        "Hesap düzeyinde yüksek red oranı, gönderimlerinin daha sıkı ve yavaş incelenmesine yol açabilir; " +
        "aynı ihlalin tekrarı 4.3(b) kapsamında ciddiye alınır.",
      kanit: { toplam_red: hesapRed },
      adimlar: [
        "En çok red alan uygulamalardan başla; ortak red gerekçesini bul (metadata, 4.3, 2.1…).",
        "Bir süre yeni uygulama göndermeyi bırakıp mevcutları sessizce temize çek.",
      ],
      yapma: ["Red alınan uygulamayı başka isim/hesapla yeniden gönderme.", "Apple'a toplu açıklama ya da şikâyet yazma."],
    });
  }

  const adminler = v.kullanicilar.filter((k) => k.roller.includes("ADMIN") || k.roller.includes("ACCOUNT_HOLDER"));
  if (adminler.length > 3) {
    out.push({
      id: bulguId("fazla-admin", undefined, "kullanici"),
      kural: "fazla-admin",
      ciddiyet: "orta",
      baslik: `Hesapta ${adminler.length} Admin/Hesap Sahibi var.`,
      neden:
        "Her Admin uygulama yükleyebilir, sözleşme ve banka bilgisine dokunabilir. Kapatılmış bir hesapla bağı olan " +
        "tek bir freelancer bile 'bağlantılı hesap' sebebiyle senin hesabını riske atar.",
      kanit: { admin_sayisi: adminler.length },
      adimlar: [
        "App Store Connect → Kullanıcılar ve Erişim'de her Admin'i gözden geçir.",
        "Gerekmeyenleri App Manager / Developer rolüne düşür, ayrılanları kaldır.",
      ],
      yapma: ["Hesap şifresini ya da Hesap Sahibi girişini başkalarıyla paylaşma — gereken kişiye kendi kullanıcısını aç."],
    });
  }
  const adminDaveti = v.davetler.filter(
    (d) => d.roller.includes("ADMIN") && (!d.bitis || Date.parse(d.bitis) > Date.parse(v.simdi)),
  );
  if (adminDaveti.length) {
    out.push({
      id: bulguId("fazla-admin", undefined, "davet"),
      kural: "fazla-admin",
      ciddiyet: "dusuk",
      baslik: `${adminDaveti.length} bekleyen Admin daveti var.`,
      neden: "Kabul edilirse davetli tüm hesaba yetkili olur; tanımadığın bir davet hesap ele geçirme girişimi olabilir.",
      kanit: { davet_sayisi: adminDaveti.length },
      adimlar: ["App Store Connect → Kullanıcılar ve Erişim → bekleyen davetleri kontrol et, tanımadıklarını iptal et."],
      yapma: ["Tanımadığın davetin bağlantısına tıklama."],
    });
  }

  return out;
}
