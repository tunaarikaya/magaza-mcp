import type { Istek } from "../../../istemci/apple.js";
import { bulguId, type Bulgu, type Uygulama, type Veri } from "../tip.js";

// Eşleşme küçük harf + aksansız + ı→i üstünde yapılır; "ÜCRETSİZ", "Pokémon" da yakalanır.
const sade = (s?: string) => (s ?? "").toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/ı/g, "i");
const kac = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sinir = (t: string, bayrak: string) => new RegExp(`(?<![\\p{L}\\p{N}])${kac(t)}(?![\\p{L}\\p{N}])`, bayrak);
const uniq = <T>(l: T[]) => [...new Set(l)];

type Liste = { terim: string; re: RegExp; sil: RegExp }[];
const liste = (terimler: string[]): Liste =>
  [...terimler]
    .sort((a, b) => b.length - a.length)
    .map((terim) => ({ terim, re: sinir(sade(terim), "u"), sil: sinir(terim, "giu") }));
const bul = (metin: string | undefined, l: Liste) => {
  const s = sade(metin);
  return l.filter((x) => x.re.test(s)).map((x) => x.terim);
};

const MARKA_APPLE = liste(["apple", "iphone", "ipad", "ios", "macos", "airpods", "siri", "facetime", "imessage", "apple watch"]);
const MARKA = liste([
  ...MARKA_APPLE.map((x) => x.terim),
  "instagram", "tiktok", "whatsapp", "facebook", "messenger", "snapchat", "youtube", "netflix", "spotify",
  "chatgpt", "openai", "gpt", "gemini", "pinterest", "telegram", "discord", "roblox", "minecraft", "fortnite",
  "pokemon", "disney", "marvel", "google", "android", "samsung", "canva", "capcut",
]);
// "smoke free", "sugar-free" gibi bileşikler fiyat iddiası değil; "free" yalnızca bunların ardında değilse sayılır.
const BILESIK_FREE = `(?<!(?:${[
  "smoke", "sugar", "ad", "ads", "stress", "hands", "gluten", "alcohol", "caffeine", "cruelty", "distraction",
  "risk", "worry", "hassle", "clutter", "debt", "pain", "anxiety", "guilt", "plastic", "carbon",
].join("|")})[\\s-])`;
const YASAK_IFADE: Liste = liste([
  "best", "#1", "no.1", "top", "free", "sale", "discount", "cheapest", "en iyi", "ücretsiz", "bedava",
  "indirim", "gratis", "gratuit", "kostenlos", "лучший", "бесплатно", "mejor", "meilleur",
]).map((x) =>
  x.terim === "free"
    ? { ...x, re: new RegExp(BILESIK_FREE + x.re.source, "u"), sil: new RegExp(BILESIK_FREE + x.sil.source, "giu") }
    : x,
);
const PLATFORM = liste(["android", "google play", "play store", "samsung galaxy", "huawei"]);
// TAM: isim / alt başlık / anahtar kelimede aranır. GUCLU: açıklamada da — orada yanlış alarm daha kolay.
const MEDYA_TAM = liste([
  "downloader", "video downloader", "save video", "mp3 converter", "youtube to mp3", "tiktok saver",
  "instagram saver", "story saver", "reels download", "reels downloader", "video indir", "video indirici",
  "müzik indir", "mp3 indir",
]);
const MEDYA_GUCLU = liste([
  "video downloader", "mp3 converter", "youtube to mp3", "tiktok saver", "instagram saver", "story saver",
  "reels downloader", "video indirici",
]);
const SAHTE_TAM = liste([
  "virus cleaner", "antivirus", "anti virus", "booster", "ram cleaner", "battery doctor", "phone tracker",
  "numaradan konum", "who viewed my profile", "profilime kim baktı", "x-ray", "xray", "röntgen",
  "lie detector", "yalan makinesi", "free followers", "takipçi hilesi", "hack",
]);
const SAHTE_GUCLU = liste([
  "virus cleaner", "ram cleaner", "battery doctor", "phone tracker", "numaradan konum", "who viewed my profile",
  "profilime kim baktı", "lie detector", "yalan makinesi", "free followers", "takipçi hilesi",
]);
const REGULE_TAM = liste([
  "vpn", "crypto", "bitcoin", "trading", "forex", "loan", "kredi", "borç", "casino", "bahis", "bet",
  "telehealth", "teşhis",
]);
const REGULE_GUCLU = liste(["bitcoin", "forex", "casino", "telehealth"]);
const GEREKSIZ = new Set(["app", "apps"]);

const SURUM_ENGEL = "Düzenlenebilir sürüm yok — App Store Connect'te yeni sürüm aç, sonra tekrar dene.";
const INFO_ENGEL =
  "Düzenlenebilir appInfo yok — isim, alt başlık ve gizlilik URL'si yalnızca hazırlanan bir sürümle değişir. " +
  "App Store Connect'te yeni sürüm aç, sonra tekrar dene.";
const DEGER = "<senin değerin>";

const yama = (type: string, id: string, attributes: Record<string, unknown>): Istek => ({
  yontem: "PATCH",
  yol: `/v1/${type}/${encodeURIComponent(id)}`,
  govde: { data: { type, id, attributes } },
});
const svl = (id: string, a: Record<string, unknown>) => yama("appStoreVersionLocalizations", id, a);
const ail = (id: string, a: Record<string, unknown>) => yama("appInfoLocalizations", id, a);

const kelimeler = (s: string) => sade(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);

function metinDegeri(deger: string | undefined, alan: string, sinirKarakter: number, yasak?: Liste): string {
  const s = (deger ?? "").trim();
  if (!s) throw new Error(`${alan} boş olamaz.`);
  if (s.length > sinirKarakter) throw new Error(`${alan} en çok ${sinirKarakter} karakter olabilir (${s.length}).`);
  const kalan = yasak ? bul(s, yasak) : [];
  if (kalan.length) throw new Error(`Yeni ${alan} hâlâ sorunlu ifade içeriyor: ${kalan.join(", ")}.`);
  return s;
}

function urlDegeri(deger: string | undefined, sadeceHttps: boolean): string {
  const s = (deger ?? "").trim();
  let u: URL | undefined;
  try {
    u = new URL(s);
  } catch {}
  const tamam = u && (sadeceHttps ? u.protocol === "https:" : /^https?:$/.test(u.protocol));
  if (!tamam) {
    throw new Error(`Geçerli bir adres değil: "${s}". ${sadeceHttps ? "https://" : "http(s)://"} ile başlayan tam bir URL ver.`);
  }
  return s;
}

/**
 * Anahtar kelimeleri temizler: isim/alt başlıkta geçen kelimeler, "app", tekrarlar, virgül sonrası boşluk;
 * markaSil ise marka adları da. anahtar-marka ve anahtar-tekrar düzeltmeleri aynı tam temizliği yazar —
 * hangisi sonra uygulanırsa uygulansın diğerinin işini geri almasın diye.
 */
function temizAnahtar(ham: string, isimKelime: Set<string>, markaSil: boolean): string {
  const gorulen = new Set<string>();
  const cikti: string[] = [];
  for (let t of ham.split(",")) {
    if (markaSil) for (const m of MARKA) t = t.replace(m.sil, " ");
    t = t
      .split(/\s+/)
      .filter((w) => w && !isimKelime.has(sade(w)) && !GEREKSIZ.has(sade(w)))
      .join(" ");
    const k = sade(t);
    if (!t || gorulen.has(k)) continue;
    gorulen.add(k);
    cikti.push(t);
  }
  return cikti.join(",");
}

function temizIfade(metin: string, terimler: string[]): string {
  let s = metin;
  for (const t of YASAK_IFADE.filter((x) => terimler.includes(x.terim))) s = s.replace(t.sil, " ");
  return s
    .replace(/\s*([-|:,–—])(?:\s*[-|:,–—])+/g, " $1")
    .replace(/^[\s\-|:,–—]+|[\s\-|:,–—]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function jaccard(a: string, b: string): number {
  const x = new Set(kelimeler(a));
  const y = new Set(kelimeler(b));
  if (!x.size && !y.size) return 1;
  const kesisim = [...x].filter((w) => y.has(w)).length;
  return kesisim / (x.size + y.size - kesisim);
}

function uygulamaKurallari(u: Uygulama): Bulgu[] {
  const cikti: Bulgu[] = [];
  const ekle = (b: Omit<Bulgu, "id" | "uygulama">, ek?: string) =>
    cikti.push({ id: bulguId(b.kural, u.id, ek), uygulama: { id: u.id, ad: u.ad }, ...b });

  const info = u.bilgiler.find((b) => b.duzenlenebilir) ?? u.bilgiler[0];
  const anaOnce = <T extends { dil: string }>(l: T[]) =>
    [...l].sort((a, b) => Number(b.dil === u.anaDil) - Number(a.dil === u.anaDil));
  const yerel = anaOnce(info?.yerel ?? []);
  const surumYerel = anaOnce(u.surumYerel);
  const infoEngel = info?.duzenlenebilir ? undefined : INFO_ENGEL;
  const surumEngel = u.hedefSurumDuzenlenebilir ? undefined : SURUM_ENGEL;
  const isimKelime = (dil: string) => {
    const y = yerel.find((x) => x.dil === dil);
    return new Set(kelimeler(`${y?.ad ?? ""} ${y?.altBaslik ?? ""}`));
  };

  // anahtar-marka
  const markali = surumYerel
    .map((s) => ({ s, hit: bul(s.anahtarKelimeler, MARKA) }))
    .filter((x) => x.hit.length);
  if (markali.length) {
    const yeni = markali.map(({ s }) => temizAnahtar(s.anahtarKelimeler!, isimKelime(s.dil), true));
    const markalar = uniq(markali.flatMap((x) => x.hit));
    ekle({
      kural: "anahtar-marka",
      ciddiyet: "yuksek",
      baslik: `Anahtar kelimelerde başka markaların adı var: ${markalar.join(", ")}`,
      neden:
        "Başkasının markasını anahtar kelimeye koymak o markanın aramalarından trafik çalmak sayılır. Apple metadata'yı " +
        "reddeder; marka sahibi şikâyet ederse uygulama kaldırılır, tekrarı hesabı riske atar.",
      kanit: { markalar, diller: markali.map((x) => x.s.dil) },
      adimlar: [
        "Bir sonraki normal güncellemende anahtar kelimelerden marka adlarını çıkar.",
        "Açılan yere uygulamanın gerçekte yaptığı işi anlatan kelimeler koy.",
      ],
      yapma: [
        "Marka adını başka bir yazımla (1nstagram, insta, tik tok) geri koyma — Apple bunu da yakalar.",
        "Sadece bunun için ayrı, acele bir gönderim yapma; normal güncellemene kat.",
      ],
      duzeltme: {
        engel: surumEngel,
        degisim: markali.map(({ s }, i) => ({ alan: `keywords (${s.dil})`, simdi: s.anahtarKelimeler, yeni: yeni[i] })),
        istekler: () => markali.map(({ s }, i) => svl(s.id, { keywords: yeni[i] })),
      },
    });
  }

  // isim-marka
  const isimMarkali = yerel
    .map((y) => ({ y, ad: bul(y.ad, MARKA), alt: bul(y.altBaslik, MARKA) }))
    .filter((x) => x.ad.length || x.alt.length);
  if (isimMarkali.length) {
    const markalar = uniq(isimMarkali.flatMap((x) => [...x.ad, ...x.alt]));
    const appleMi = markalar.some((m) => MARKA_APPLE.some((a) => a.terim === m));
    const hedef = isimMarkali[0];
    const alan = hedef.ad.length ? "name" : "subtitle";
    const alanAdi = alan === "name" ? "isim" : "alt başlık";
    ekle(
      {
        kural: "isim-marka",
        ciddiyet: appleMi ? "kritik" : "yuksek",
        baslik: `İsim veya alt başlıkta marka adı var: ${markalar.join(", ")}`,
        neden: appleMi
          ? "Apple markalarını (iPhone, iOS, Apple Watch…) isimde kullanmak 5.2.5'e göre doğrudan red sebebi; ısrar " +
            "edilirse uygulama kaldırılır."
          : "Başka şirketin markasını isimde kullanmak taklit (4.1) ve fikri mülkiyet ihlali sayılır; marka sahibi " +
            "şikâyet ederse uygulama kaldırılır, tekrarlanırsa hesap da risk altına girer.",
        kanit: { markalar, diller: isimMarkali.map((x) => x.y.dil) },
        adimlar: [
          "Bir sonraki normal güncellemende ismi ve alt başlığı marka adı geçmeyecek şekilde yeniden yaz (en çok 30 karakter).",
          "\"for Instagram\", \"iPhone için\" gibi ifadeler de ihlal sayılır; işlevi anlatan genel kelimeler kullan.",
          "Düzeltme önce ana dili hedefler; sonra diğer dilleri de aynı güncellemeye kat.",
        ],
        yapma: [
          "Marka adını başka bir yazımla (1nstagram, Insta, ChatGBT) geri koyma.",
          "İkonda ya da ekran görüntülerinde o markanın logosunu kullanmaya devam etme.",
        ],
        duzeltme: {
          engel: infoEngel,
          gerekenDeger: `yeni ${alanAdi} (${hedef.y.dil}, en çok 30 karakter)`,
          degisim: [{ alan: `${alan} (${hedef.y.dil})`, simdi: alan === "name" ? hedef.y.ad : hedef.y.altBaslik, yeni: DEGER }],
          istekler: (deger) => [ail(hedef.y.id, { [alan]: metinDegeri(deger, alanAdi, 30, MARKA) })],
        },
      },
      hedef.y.dil,
    );
  }

  // isim-yasak-ifade
  const yasakli = yerel
    .map((y) => ({ y, ad: bul(y.ad, YASAK_IFADE), alt: bul(y.altBaslik, YASAK_IFADE) }))
    .filter((x) => x.ad.length || x.alt.length);
  if (yasakli.length) {
    const yeni = yasakli.map((x) => ({
      ...(x.ad.length ? { name: temizIfade(x.y.ad, x.ad) } : {}),
      ...(x.alt.length ? { subtitle: temizIfade(x.y.altBaslik ?? "", x.alt) } : {}),
    }));
    const eski = yasakli.map((x) => ({ name: x.y.ad, subtitle: x.y.altBaslik }));
    // Boş kalan ya da hiç değişmeyen alan varsa otomatik düzeltme güvenli değil.
    const guvenli = yeni.every((a, i) =>
      Object.entries(a).every(([k, v]) => v && v !== eski[i][k as "name" | "subtitle"]),
    );
    const ifadeler = uniq(yasakli.flatMap((x) => [...x.ad, ...x.alt]));
    ekle({
      kural: "isim-yasak-ifade",
      ciddiyet: "orta",
      baslik: `İsim veya alt başlıkta yasak ifade var: ${ifadeler.join(", ")}`,
      neden:
        "Apple isim ve alt başlıkta 'en iyi', '#1', 'ücretsiz', 'indirim' gibi sıralama ve fiyat iddialarını yasaklar " +
        "(2.3.7). Bir sonraki gönderimde metadata reddi gelebilir.",
      kanit: { ifadeler, diller: yasakli.map((x) => x.y.dil) },
      adimlar: ["Bir sonraki normal güncellemende bu ifadeleri isim ve alt başlıktan çıkar."],
      yapma: ["Aynı iddiayı ekran görüntüsüne ya da tanıtım metnine taşıma (\"#1\", \"ücretsiz\" orada da sayılır)."],
      ...(guvenli
        ? {
            duzeltme: {
              engel: infoEngel,
              degisim: yasakli.flatMap((x, i) =>
                Object.entries(yeni[i]).map(([k, v]) => ({
                  alan: `${k} (${x.y.dil})`,
                  simdi: eski[i][k as "name" | "subtitle"],
                  yeni: v,
                })),
              ),
              istekler: () => yasakli.map((x, i) => ail(x.y.id, yeni[i])),
            },
          }
        : {}),
    });
  }

  // anahtar-tekrar
  const tekrarli = surumYerel
    .filter((s) => s.anahtarKelimeler)
    .map((s) => ({ s, temiz: temizAnahtar(s.anahtarKelimeler!, isimKelime(s.dil), false) }))
    .filter((x) => x.temiz !== x.s.anahtarKelimeler);
  if (tekrarli.length) {
    const yeni = tekrarli.map(({ s }) => temizAnahtar(s.anahtarKelimeler!, isimKelime(s.dil), true));
    ekle({
      kural: "anahtar-tekrar",
      ciddiyet: "dusuk",
      baslik: "Anahtar kelimelerde boşa harcanan karakter var (tekrar, isimde geçen kelime, 'app', boşluk)",
      neden:
        "Risk düşük ama kayıp gerçek: Apple isim ve alt başlığı zaten indeksler; tekrarlar, 'app' ve virgül sonrası " +
        "boşluk 100 karakterlik alanı boşa yer. Aşırı tekrar 'keyword stuffing' gibi de görünebilir.",
      kanit: tekrarli.map(({ s, temiz }) => ({ dil: s.dil, kazanc: s.anahtarKelimeler!.length - temiz.length })),
      adimlar: [
        "Bir sonraki normal güncellemende tekrarları, isim/alt başlıkta zaten geçen kelimeleri ve 'app'i sil; virgülden sonra boşluk bırakma.",
        "Açılan yere yeni, alakalı anahtar kelimeler ekle.",
      ],
      yapma: ["Açılan yere rakip ya da marka adı doldurma."],
      duzeltme: {
        engel: surumEngel,
        degisim: tekrarli.map(({ s }, i) => ({ alan: `keywords (${s.dil})`, simdi: s.anahtarKelimeler, yeni: yeni[i] })),
        istekler: () => tekrarli.map(({ s }, i) => svl(s.id, { keywords: yeni[i] })),
      },
    });
  }

  // kelime-doldurma
  // "Marka: açıklama", "X & Y", "Marka - Açıklama" normal isimdir; yalnızca liste ayraçları sayılır.
  const dolu = yerel.filter((y) => {
    const liste = (y.ad.match(/[,|/•·]/g) ?? []).length;
    const tire = (y.ad.match(/\s[-–—]\s/g) ?? []).length;
    return liste >= 2 || liste + tire >= 3;
  });
  if (dolu.length) {
    const hedef = dolu[0];
    ekle(
      {
        kural: "kelime-doldurma",
        ciddiyet: "orta",
        baslik: `İsme anahtar kelime dizilmiş: "${hedef.ad}"`,
        neden:
          "İsme virgül ya da tire ile anahtar kelime dizmek (2.3.7) Apple'ın en sık metadata reddi sebeplerinden.",
        kanit: { isimler: dolu.map((y) => ({ dil: y.dil, ad: y.ad })) },
        adimlar: [
          "Bir sonraki normal güncellemende ismi markan + en fazla bir tanımlayıcı olacak şekilde kısalt (ör. \"Lumo: Photo Editor\").",
          "Çıkardığın kelimeleri anahtar kelime alanına taşı.",
        ],
        yapma: ["Aynı gün tüm dillerde ve tüm uygulamalarda isim değiştirip incelemeye yığma; uygulama uygulama, normal güncellemeyle ilerle."],
        duzeltme: {
          engel: infoEngel,
          gerekenDeger: `yeni kısa isim (${hedef.dil}, en çok 30 karakter)`,
          degisim: [{ alan: `name (${hedef.dil})`, simdi: hedef.ad, yeni: DEGER }],
          istekler: (deger) => [ail(hedef.id, { name: metinDegeri(deger, "isim", 30) })],
        },
      },
      hedef.dil,
    );
  }

  // aciklama-platform
  const ALANLAR = [
    { k: "aciklama", attr: "description", ad: "açıklama", sinir: 4000 },
    { k: "tanitimMetni", attr: "promotionalText", ad: "tanıtım metni", sinir: 170 },
    { k: "yenilikler", attr: "whatsNew", ad: "yenilikler metni", sinir: 4000 },
  ] as const;
  const platformlu = surumYerel.flatMap((s) =>
    ALANLAR.map((a) => ({ s, a, hit: bul(s[a.k], PLATFORM) })).filter((x) => x.hit.length),
  );
  if (platformlu.length) {
    const hedef = platformlu[0];
    const platformlar = uniq(platformlu.flatMap((x) => x.hit));
    ekle(
      {
        kural: "aciklama-platform",
        ciddiyet: "orta",
        baslik: `Metinde başka platformun adı geçiyor: ${platformlar.join(", ")}`,
        neden:
          "App Store metninde Android, Google Play gibi başka mobil platformlardan bahsetmek 2.3.10'a göre red sebebi; " +
          "düzeltilene kadar sürüm yayına çıkmaz.",
        kanit: { platformlar, yerler: platformlu.map((x) => `${x.s.dil}: ${x.a.ad}`) },
        adimlar: [
          "Bir sonraki normal güncellemende metinden başka platform adlarını ve 'Android'de de var' gibi cümleleri çıkar.",
          "Birden çok dil/alan etkileniyorsa hepsini aynı güncellemeye kat; düzeltme önce ana dili hedefler.",
        ],
        yapma: ["Başka platformu ekran görüntülerinde ya da 'yenilikler' metninde anmaya devam etme."],
        duzeltme: {
          engel: surumEngel,
          gerekenDeger: `yeni ${hedef.a.ad} (${hedef.s.dil}, en çok ${hedef.a.sinir} karakter)`,
          degisim: [{ alan: `${hedef.a.attr} (${hedef.s.dil})`, simdi: hedef.s[hedef.a.k], yeni: DEGER }],
          istekler: (deger) => [svl(hedef.s.id, { [hedef.a.attr]: metinDegeri(deger, hedef.a.ad, hedef.a.sinir, PLATFORM) })],
        },
      },
      hedef.s.dil,
    );
  }

  // gizlilik-url-yok
  const gizlilikEksik = yerel.filter((y) => !y.gizlilikUrl?.trim());
  if (gizlilikEksik.length) {
    ekle({
      kural: "gizlilik-url-yok",
      ciddiyet: "yuksek",
      baslik: "Gizlilik politikası bağlantısı eksik",
      neden:
        "Gizlilik politikası bağlantısı her uygulama için zorunlu (5.1.1(i)); eksikse gönderim reddedilir ya da hiç " +
        "gönderilemez.",
      kanit: { diller: gizlilikEksik.map((y) => y.dil) },
      adimlar: [
        "Herkese açık, https ile çalışan bir gizlilik politikası sayfası yayınla.",
        "App Store Connect → Uygulama Bilgileri → Gizlilik Politikası URL'sine ekle (her dil için).",
      ],
      yapma: ["Boş, 404 veren ya da başka bir uygulamaya ait şablon sayfayı bağlama — inceleyen tıklayıp bakar."],
      duzeltme: {
        engel: infoEngel,
        gerekenDeger: "gizlilik politikası URL'si (https://…)",
        degisim: gizlilikEksik.map((y) => ({ alan: `privacyPolicyUrl (${y.dil})`, simdi: y.gizlilikUrl ?? null, yeni: DEGER })),
        istekler: (deger) => {
          const url = urlDegeri(deger, true);
          return gizlilikEksik.map((y) => ail(y.id, { privacyPolicyUrl: url }));
        },
      },
    });
  }

  // destek-url-yok
  const destekEksik = surumYerel.filter((s) => !s.destekUrl?.trim());
  if (destekEksik.length) {
    ekle({
      kural: "destek-url-yok",
      ciddiyet: "orta",
      baslik: "Destek bağlantısı eksik",
      neden:
        "Destek bağlantısı zorunlu ve kullanıcının sana ulaşabileceği çalışan bir sayfa olmalı (1.5, 2.1); eksikse " +
        "sürüm reddedilir.",
      kanit: { diller: destekEksik.map((s) => s.dil) },
      adimlar: ["İletişim bilgisi içeren bir destek sayfası yayınla ve bir sonraki güncellemende her dilin Destek URL'sine ekle."],
      yapma: ["Ana sayfaya ya da çalışmayan bir adrese yönlendirme — sayfada sana ulaşmanın bir yolu olmalı."],
      duzeltme: {
        engel: surumEngel,
        gerekenDeger: "destek sayfası URL'si (https://…)",
        degisim: destekEksik.map((s) => ({ alan: `supportUrl (${s.dil})`, simdi: s.destekUrl ?? null, yeni: DEGER })),
        istekler: (deger) => {
          const url = urlDegeri(deger, false);
          return destekEksik.map((s) => svl(s.id, { supportUrl: url }));
        },
      },
    });
  }

  // medya-indirici / sahte-islev / regule-alan — yalnızca rehber
  const kimlikMetni = [...yerel.flatMap((y) => [y.ad, y.altBaslik]), ...surumYerel.map((s) => s.anahtarKelimeler)].join("\n");
  const aciklamaMetni = surumYerel.flatMap((s) => [s.aciklama, s.tanitimMetni, s.yenilikler]).join("\n");
  const tara = (tam: Liste, guclu: Liste) => uniq([...bul(kimlikMetni, tam), ...bul(aciklamaMetni, guclu)]);

  const medya = tara(MEDYA_TAM, MEDYA_GUCLU);
  if (medya.length) {
    ekle({
      kural: "medya-indirici",
      ciddiyet: "kritik",
      baslik: `Uygulama video/müzik indirici gibi görünüyor: ${medya.join(", ")}`,
      neden:
        "YouTube, TikTok, Instagram gibi servislerden izinsiz video/müzik indirmeye yarayan uygulamalar 5.2.3'e göre " +
        "yasak. Bu ifade gerçek bir hesap kapatma bildiriminde bire bir geçti — red değil, doğrudan kaldırma ve hesap " +
        "kapatma riski.",
      kanit: { terimler: medya },
      adimlar: [
        "Uygulama gerçekten üçüncü taraf içerik indiriyorsa bir sonraki sürümde bu işlevi koddan tamamen kaldır.",
        "Aynı sürümde indirme çağrışımı yapan kelimeleri isim, alt başlık, anahtar kelime ve açıklamadan çıkar.",
        "Yanlış alarmsa (ör. kendi içeriğini çevrimdışı kaydetme), uygulamayı gerçek işlevine göre yeniden konumla.",
      ],
      yapma: [
        "Sadece metindeki kelimeyi silip işlevi gizlice bırakma — bu 2.3.1 'gizli özellik' olur, daha ağır.",
        "Apple'a kendiliğinden açıklama yazma.",
      ],
    });
  }

  const sahte = tara(SAHTE_TAM, SAHTE_GUCLU);
  if (sahte.length) {
    ekle({
      kural: "sahte-islev",
      ciddiyet: "yuksek",
      baslik: `iOS'ta mümkün olmayan bir işlev vaat ediliyor: ${sahte.join(", ")}`,
      neden:
        "iPhone'da virüs temizleme, RAM/pil hızlandırma, 'profilime kim baktı', röntgen gibi işlevler teknik olarak " +
        "mümkün değil; Apple bunları yanıltıcı uygulama sayar (1.1.6). Apple, WWDC öğrenci yarışması kazananının " +
        "hesabını yanıltıcı bir uygulama yüzünden kapattı.",
      kanit: { terimler: sahte },
      adimlar: [
        "Bir sonraki sürümde uygulamanın gerçekte yapmadığı bir şeyi vaat eden ifadeleri tüm metadata'dan ve uygulama içinden kaldır.",
        "Eğlence/şaka uygulamasıysa onu öyle yeniden konumla; isimde ve açıklamada açıkça belirt (ör. \"şaka amaçlıdır\").",
      ],
      yapma: [
        "Sadece metindeki kelimeyi silip vaadi uygulama içinde gizlice bırakma — bu 2.3.1 'gizli özellik' olur, daha ağır.",
        "Apple'a kendiliğinden açıklama yazma.",
      ],
    });
  }

  const regule = tara(REGULE_TAM, REGULE_GUCLU);
  if (regule.length) {
    ekle({
      kural: "regule-alan",
      ciddiyet: "orta",
      baslik: `Şirket hesabı gerektiren bir alanda: ${regule.join(", ")}`,
      neden:
        "VPN, kripto, kredi, kumar ve sağlık uygulamalarını Apple yalnızca şirket (organization) hesaplarından kabul " +
        "eder (5.1.1(ix), 5.4, 3.1.5). Bireysel hesapla yayınlamak red ya da kaldırma sebebi; şirket hesabıysan sorun yok.",
      kanit: { terimler: regule, not: "API hesap türünü (bireysel/şirket) vermiyor; bunu sen bilirsin." },
      adimlar: [
        "Önce hesap türüne bak (App Store Connect → Üyelik): şirketse sorun yok, sadece lisans/izin belgelerini hazır tut.",
        "Bireyselse: uygulamayı bir şirket hesabına transfer et ya da bir sonraki sürümde regüle işlevi uygulamadan çıkar.",
      ],
      yapma: ["Kategoriyi ya da metni yanlış göstererek regüle alanı gizleme — işlev uygulamada kaldıkça risk sürer."],
    });
  }

  // konsept-degisimi
  const eskiInfo = u.bilgiler.find((b) => !b.duzenlenebilir);
  const yeniInfo = u.bilgiler.find((b) => b.duzenlenebilir);
  if (eskiInfo && yeniInfo && eskiInfo.id !== yeniInfo.id) {
    const isimFarki = yeniInfo.yerel
      .map((y) => ({ y, e: eskiInfo.yerel.find((x) => x.dil === y.dil) }))
      .filter((x) => x.e && jaccard(x.e.ad, x.y.ad) < 0.3)
      .map((x) => ({ dil: x.y.dil, eski: x.e!.ad, yeni: x.y.ad }));
    const kategoriFarki = eskiInfo.kategori && yeniInfo.kategori && eskiInfo.kategori !== yeniInfo.kategori;
    if (isimFarki.length || kategoriFarki) {
      ekle({
        kural: "konsept-degisimi",
        ciddiyet: "yuksek",
        baslik: "Hazırlanan sürümde uygulamanın adı/kategorisi kökten değişiyor",
        neden:
          "Onaydan sonra uygulamayı bambaşka bir şeye çevirmek Apple'ın 'bait-and-switch' dediği şey (DPLA 11.2(g)); " +
          "2025'te bu yüzden 59 bin uygulama kaldırıldı. Uygulamanın gerçek içeriğiyle uyumlu bir yeniden markalaşma sorun değil.",
        kanit: {
          isimler: isimFarki,
          ...(kategoriFarki ? { kategori: { eski: eskiInfo.kategori, yeni: yeniInfo.kategori } } : {}),
        },
        adimlar: [
          "Gerçek bir yeniden markalaşmaysa, bu sürümdeki yeni özellikleri inceleme notunda olgusal olarak anlat (normal kanal budur).",
          "İsim/kategori değişikliğini kademeli yap ve uygulamanın gerçek içeriğiyle uyumlu tut.",
          "Uygulamanın işlevi tamamen değişiyorsa ayrı bir uygulama olarak yayınlamayı düşün.",
        ],
        yapma: [
          "İnceleme sürerken isim ya da kategori değiştirme.",
          "Onaydan sonra uygulamanın işlevini uzaktan (remote config) değiştirme.",
        ],
      });
    }
  }

  return cikti;
}

export function metadataKurallari(v: Veri): Bulgu[] {
  return v.uygulamalar.flatMap(uygulamaKurallari);
}
