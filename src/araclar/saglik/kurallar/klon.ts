/**
 * Klon / spam (4.3) kuralları — uygulamaları birbiriyle karşılaştırır.
 *
 * Apple 4.3: "Spamming the store may lead to removal from the Apple Developer
 * Program." Tek tek masum görünen uygulamalar yan yana konunca şablon
 * fabrikası gibi görünür; bu dosya o yan yana bakışı yapar.
 */
import { bulguId, type Bulgu, type Ciddiyet, type Uygulama, type Veri } from "../tip.js";

const GUN = 86_400_000;

const sade = (s?: string | null) =>
  (s ?? "").toLocaleLowerCase("tr").replace(/ı/g, "i").normalize("NFKD").replace(/\p{M}/gu, "");

const kelimeler = (s?: string | null) => sade(s).split(/[^\p{L}]+/u).filter((k) => k.length >= 2);

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size || !b.size) return 0;
  let ortak = 0;
  for (const x of a) if (b.has(x)) ortak++;
  return ortak / (a.size + b.size - ortak);
}

// sınır: O(n²) çift karşılaştırma; birkaç yüz uygulamaya kadar anlık, binlerce olursa MinHash/LSH
function grupla<T>(ogeler: T[], bagli: (a: T, b: T) => boolean, enAz = 2): T[][] {
  const kok = ogeler.map((_, i) => i);
  const bul = (i: number): number => (kok[i] === i ? i : (kok[i] = bul(kok[i])));
  for (let i = 0; i < ogeler.length; i++)
    for (let j = i + 1; j < ogeler.length; j++)
      if (bul(i) !== bul(j) && bagli(ogeler[i], ogeler[j])) kok[bul(i)] = bul(j);
  const gruplar = new Map<number, T[]>();
  ogeler.forEach((o, i) => gruplar.set(bul(i), [...(gruplar.get(bul(i)) ?? []), o]));
  return [...gruplar.values()].filter((g) => g.length >= enAz);
}

const grupEki = (g: Uygulama[]) => g.map((u) => u.id).sort().join("+");
const adlar = (g: Uygulama[]) => g.map((u) => u.ad);
const tekil = (u: Uygulama) => ({ id: u.id, ad: u.ad });

const SPAM_SONUCU =
  "Apple 4.3'te 'mağazayı spam'lemek Developer Program'dan çıkarılmaya götürebilir' diyor; " +
  "DPLA 3.2(f) de birbirinin benzeri uygulamalarla mağazayı doldurmayı yasaklıyor. Önce red gelir, " +
  "tekrarlanırsa uygulamalar kaldırılır ve hesap kapatılabilir.";

const BIRLESTIR = [
  "Uygulamalar gerçekten aynı işi yapıyorsa tek uygulamada birleştir; farklı içerikleri uygulama içi seçenek ya da IAP yap.",
  "Birleştirdikten sonra fazlalıkları App Store Connect → Fiyat ve Bulunabilirlik'ten satıştan kaldır (bunu elle yap, araç yapmaz).",
];

// ─── klon-ekran-goruntusu ────────────────────────────────────────────────

function ekranGoruntusu(v: Veri): Bulgu[] {
  const kume = new Map(v.uygulamalar.map((u) => [u, new Set((u.ekranGoruntuleri ?? []).map((e) => e.checksum).filter(Boolean))]));
  return grupla(v.uygulamalar, (a, b) => [...kume.get(a)!].some((c) => kume.get(b)!.has(c))).map((g) => {
    const sayac = new Map<string, number>();
    for (const u of g) for (const c of kume.get(u)!) sayac.set(c, (sayac.get(c) ?? 0) + 1);
    return {
      id: bulguId("klon-ekran-goruntusu", undefined, grupEki(g)),
      kural: "klon-ekran-goruntusu",
      ciddiyet: g.length >= 3 ? "kritik" : "yuksek",
      baslik: `${g.length} uygulama aynı ekran görüntülerini kullanıyor`,
      neden:
        "Apple farklı uygulamalarda birebir aynı ekran görüntüsünü görünce bunları aynı uygulamanın kopyaları sayar. " +
        SPAM_SONUCU,
      kanit: { uygulamalar: adlar(g), ortak_ekran_goruntusu: [...sayac.values()].filter((n) => n > 1).length },
      adimlar: [
        "Her uygulamaya kendi gerçek ekranlarını gösteren özgün ekran görüntüleri hazırla ve yeni sürümle yükle.",
        ...BIRLESTIR,
      ],
    };
  });
}

// ─── klon-isim ───────────────────────────────────────────────────────────

const ISIM_EKLERI = new Set([
  "pro", "lite", "free", "plus", "app", "apps", "hd", "premium", "ucretsiz", "max", "mini", "ultra", "new", "yeni", "the", "for", "by",
]);

function isimKlonu(v: Veri): Bulgu[] {
  const tok = new Map(v.uygulamalar.map((u) => [u, kelimeler(u.ad).filter((k) => !ISIM_EKLERI.has(k))]));
  const onek = (a: string[], b: string[]) =>
    a.length > 0 && b.length > 0 && (a.length <= b.length ? a.every((k, i) => b[i] === k) : b.every((k, i) => a[i] === k));
  return grupla(v.uygulamalar, (a, b) => {
    const ta = tok.get(a)!, tb = tok.get(b)!;
    return jaccard(new Set(ta), new Set(tb)) >= 0.6 || onek(ta, tb);
  }).map((g) => ({
    id: bulguId("klon-isim", undefined, grupEki(g)),
    kural: "klon-isim",
    ciddiyet: "yuksek",
    baslik: `${g.length} uygulamanın adı neredeyse aynı`,
    neden:
      "'Pro', 'Lite', 'HD' gibi eklerle çoğaltılmış aynı isim, Apple'a aynı uygulamanın varyantlarını ayrı ayrı " +
      "yayınladığını söyler. " + SPAM_SONUCU,
    kanit: { uygulamalar: adlar(g) },
    adimlar: [
      "Varyantları (ücretsiz/pro, tema, dil) tek uygulamada topla; ücretli kısmı IAP ya da abonelik yap.",
      "Gerçekten farklı uygulamalarsa her birine işlevini anlatan özgün bir isim ver.",
      ...BIRLESTIR.slice(1),
    ],
  }));
}

// ─── klon-aciklama ───────────────────────────────────────────────────────

const anaAciklama = (u: Uygulama) =>
  ((u.surumYerel ?? []).find((y) => y.dil === u.anaDil) ?? (u.surumYerel ?? [])[0])?.aciklama;

function shingle(metin?: string): Set<string> {
  const k = kelimeler(metin);
  const s = new Set<string>();
  for (let i = 0; i + 5 <= k.length; i++) s.add(k.slice(i, i + 5).join(" "));
  return s;
}

const SABLON_IZLERI: RegExp[] = [
  /lorem ipsum/,
  /\[\s*app\s*name\s*\]/,
  /\{\{?\s*app[_\s]?name\s*\}\}?/,
  /%app_?name%/,
  /your app name/,
  /app name here/,
  /insert (?:app|your) name/,
  /\b(?:appy ?pie|buildfire|thunkable|adalo|andromo|appsgeyser|goodbarber|shoutem|swiftic|appmakr|bubble\.io|glideapps|flutterflow)\b/,
];

function aciklamaKlonu(v: Veri): Bulgu[] {
  const sh = new Map(v.uygulamalar.map((u) => [u, shingle(anaAciklama(u))]));
  const gruplar: Bulgu[] = grupla(v.uygulamalar, (a, b) => jaccard(sh.get(a)!, sh.get(b)!) >= 0.5).map((g) => ({
    id: bulguId("klon-aciklama", undefined, grupEki(g)),
    kural: "klon-aciklama",
    ciddiyet: "yuksek",
    baslik: `${g.length} uygulamanın açıklaması büyük ölçüde aynı`,
    neden: "Aynı açıklamayı birden çok uygulamada kullanmak, Apple'ın şablonla üretilmiş kopya uygulama arayan kontrolüne doğrudan takılır. " + SPAM_SONUCU,
    kanit: { uygulamalar: adlar(g) },
    adimlar: [
      "Her uygulamanın açıklamasını o uygulamanın kendi özelliklerini anlatacak şekilde baştan yaz.",
      ...BIRLESTIR,
    ],
  }));

  const sablon: Bulgu[] = v.uygulamalar.flatMap((u) => {
    const metin = sade(
      [u.ad, ...(u.surumYerel ?? []).map((y) => y.aciklama), ...(u.bilgiler ?? []).flatMap((b) => b.yerel.map((y) => y.ad))].join("\n"),
    );
    const eslesen = SABLON_IZLERI.map((r) => metin.match(r)?.[0]).filter((m): m is string => !!m);
    if (!eslesen.length) return [];
    return [{
      id: bulguId("klon-aciklama", u.id, "sablon"),
      kural: "klon-aciklama" as const,
      ciddiyet: "orta" as Ciddiyet,
      uygulama: tekil(u),
      baslik: "Metinde şablon ya da uygulama üreteci izi var",
      neden:
        "4.2.6: Apple, hazır şablon ya da uygulama üreteci hizmetiyle üretilmiş uygulamaları reddeder. Doldurulmamış " +
        "yer tutucular ('[app name]', 'lorem ipsum') veya üreteç adı bunun en açık izidir; ayrıca 2.1 eksik içerik reddi getirir.",
      kanit: { eslesen },
      adimlar: [
        "Açıklama ve isimdeki yer tutucuları ve üreteç adlarını temizle.",
        "Uygulama bir üreteçle yapıldıysa Apple'ın 4.2.6 istisnasına (üretecin kendi hesabından, müşterinin adına yayın) uyup uymadığını kontrol et.",
      ],
    }];
  });

  return [...gruplar, ...sablon];
}

// ─── sirali-bundle ───────────────────────────────────────────────────────

function siraliBundle(v: Veri): Bulgu[] {
  const kokler = new Map<string, Uygulama[]>();
  for (const u of v.uygulamalar) {
    const b = (u.bundleId ?? "").toLowerCase();
    if (!b) continue;
    const kok = b.replace(/\d+$/, "").replace(/[._-]+$/, "");
    kokler.set(kok, [...(kokler.get(kok) ?? []), u]);
  }
  return [...kokler].filter(([, g]) => g.length >= 3).map(([kok, g]) => ({
    id: bulguId("sirali-bundle", undefined, kok),
    kural: "sirali-bundle",
    ciddiyet: g.length >= 5 ? "yuksek" : "orta",
    baslik: `${g.length} uygulamanın bundle id'si sıralı (${kok}…)`,
    neden:
      "app1, app2, app3 diye giden bundle id'ler aynı projeden çoğaltılmış uygulamaların tipik izidir; Apple'ın spam " +
      "taraması benzer metadata ile birlikte bunu da değerlendirir. " + SPAM_SONUCU,
    kanit: { uygulamalar: g.map((u) => `${u.ad} (${u.bundleId})`) },
    adimlar: [
      "Bundle id yayından sonra değişmez; asıl önemli olan bu uygulamaların içerik ve metadata olarak gerçekten farklı olması.",
      ...BIRLESTIR,
    ],
  }));
}

// ─── doymus-kategori ─────────────────────────────────────────────────────

const TEMALAR: Record<string, { ad: string; terimler: string[] }> = {
  fal: { ad: "fal / burç / astroloji", terimler: ["fal", "fali", "falci", "tarot", "burc\\p{L}*", "astrolo\\p{L}*", "horosc\\p{L}*", "horoskop\\p{L}*", "zodiac", "fortune ?tell\\p{L}*", "palm ?read\\p{L}*"] },
  fener: { ad: "el feneri", terimler: ["flashlight\\p{L}*", "torch", "fener\\p{L}*", "linterna", "taschenlampe", "lampe torche"] },
  duvar: { ad: "duvar kağıdı", terimler: ["wallpaper\\p{L}*", "duvar kagid\\p{L}*", "fondos? de pantalla", "hintergrundbild\\p{L}*", "fond d ?ecran"] },
  saka: { ad: "osuruk / şaka / ses tahtası", terimler: ["fart\\p{L}*", "osuruk\\p{L}*", "burp\\p{L}*", "prank\\p{L}*", "saka", "soundboard\\p{L}*", "whoopee", "broma\\p{L}*"] },
  flort: { ad: "flört", terimler: ["dating", "flort\\p{L}*", "tanisma", "citas", "rencontre\\p{L}*", "hookup"] },
  icki: { ad: "içki oyunu", terimler: ["drinking games?", "icki oyun\\p{L}*", "never have i ever", "truth or dare", "beer pong", "juegos? de beber", "trinkspiel\\p{L}*"] },
  kamasutra: { ad: "Kama Sutra", terimler: ["kama ?sutra", "sex positions?"] },
  qr: { ad: "QR / barkod okuyucu", terimler: ["qr", "barcode\\p{L}*", "barkod\\p{L}*"] },
  temizleyici: { ad: "telefon temizleyici", terimler: ["cleaner", "clean ?up", "temizleyici", "limpiador\\p{L}*", "reiniger", "nettoyeur", "junk files?"] },
  ai: { ad: "AI sohbet sarmalayıcı", terimler: ["ai chat\\p{L}*", "chat ?ai", "chat ?gpt", "gpt ?chat", "chatbot\\p{L}*", "ai assistant", "ask ai", "ai sohbet", "yapay zeka (?:sohbet|asistan)\\p{L}*"] },
  sticker: { ad: "emoji / çıkartma", terimler: ["emoji\\p{L}*", "sticker\\p{L}*", "cikartma\\p{L}*", "pegatinas?"] },
  zil: { ad: "zil sesi", terimler: ["ringtone\\p{L}*", "zil ses\\p{L}*", "tonos de llamada", "klingelton\\p{L}*", "sonnerie\\p{L}*"] },
};

const TEMA_REGEX = Object.fromEntries(
  Object.entries(TEMALAR).map(([k, t]) => [k, new RegExp(`(?:^|[^\\p{L}\\p{N}])(${t.terimler.join("|")})(?=$|[^\\p{L}\\p{N}])`, "gu")]),
);

function doymusKategori(v: Veri): Bulgu[] {
  const eslesme = new Map<string, { uygulamalar: Uygulama[]; terimler: Set<string> }>();
  // Anahtar kelimelere bakılmaz: "dating", "barcode" gibi kelimeler orada ikincil özellik olarak geçiyor, tema değil.
  for (const u of v.uygulamalar) {
    const metin = sade(
      [u.ad, ...(u.bilgiler ?? []).flatMap((b) => b.yerel.flatMap((y) => [y.ad, y.altBaslik]))].filter(Boolean).join(" | "),
    );
    for (const [tema, r] of Object.entries(TEMA_REGEX)) {
      const bulunan = [...metin.matchAll(r)].map((m) => m[1]);
      if (!bulunan.length) continue;
      const e = eslesme.get(tema) ?? { uygulamalar: [], terimler: new Set<string>() };
      e.uygulamalar.push(u);
      bulunan.forEach((t) => e.terimler.add(t));
      eslesme.set(tema, e);
    }
  }
  // Tek uygulama doymuş kategoride olabilir; risk aynı temada birden çok uygulama yayınlamakta (4.3(b) "tekrar eden gönderim").
  return [...eslesme].filter(([, e]) => e.uygulamalar.length >= 2).map(([tema, { uygulamalar: g, terimler }]) => ({
    id: bulguId("doymus-kategori", undefined, tema),
    kural: "doymus-kategori",
    ciddiyet: g.length >= 4 ? "yuksek" : "orta",
    baslik: `${g.length} uygulama aynı doymuş kategoride: ${TEMALAR[tema].ad}`,
    neden:
      "Apple 4.3(b)'de fener, osuruk/geğirme, fal, flört, içki oyunu ve Kama Sutra gibi kategorilerin zaten doymuş " +
      "olduğunu, yüksek kaliteli ve özgün bir deneyim sunmadıkça reddedileceğini yazar; bu kategorilerde tekrar eden " +
      "gönderimlerin Developer Program'dan çıkarılmaya götürebileceğini de ekler.",
    kanit: { tema: TEMALAR[tema].ad, uygulamalar: adlar(g), eslesen: [...terimler] },
    adimlar: ["Aynı temadaki uygulamaları tek, daha kapsamlı bir uygulamada birleştir.", ...BIRLESTIR.slice(1)],
  }));
}

// ─── yabanci-copyright ───────────────────────────────────────────────────

const SIRKET_EKLERI = new Set([
  "inc", "ltd", "llc", "gmbh", "co", "corp", "corporation", "limited", "sti", "sa", "sas", "srl", "bv", "pty", "ug", "ag", "plc", "copyright",
]);

function sahip(copyright?: string): string {
  return sade(copyright)
    .replace(/all rights reserved|tum haklari saklidir/g, " ")
    .split(/[^\p{L}]+/u)
    .filter((k) => k.length >= 2 && !SIRKET_EKLERI.has(k))
    .join(" ");
}

function guncelCopyright(u: Uygulama): string | undefined {
  const surumler = u.surumler ?? [];
  return (surumler.find((s) => s.id === u.hedefSurumId && s.copyright?.trim()) ?? surumler.find((s) => s.copyright?.trim()))?.copyright;
}

const kompakt = (s: string) => s.replace(/\s+/g, "");

/** Uygulamanın kendi adı/markası: tam isim, ":" / " - " ile ayrılan parçaları, bundle id'nin son parçası. */
function markalar(u: Uygulama): string[] {
  const isimler = [u.ad, ...(u.bilgiler ?? []).flatMap((b) => b.yerel.map((y) => y.ad))];
  const parcalar = isimler.flatMap((a) => [a, ...String(a ?? "").split(/\s*[:|]\s*|\s+[-–—]\s+/)]);
  return [...parcalar, (u.bundleId ?? "").split(".").pop()].map((p) => kompakt(sahip(p))).filter((p) => p.length >= 3);
}

/** "2026 Calorie Friend" gibi copyright'ta uygulamanın kendi markası yazıyorsa yabancı sahip değildir. */
function kendiMarkasi(u: Uygulama, s: string): boolean {
  const k = kompakt(s);
  return k.length >= 3 && markalar(u).some((m) => m.includes(k) || k.includes(m));
}

/** "smartify" ile "smartify apps" aynı sahip: birinin kelimeleri diğerinin içinde. */
function ayniSahip(a: string, b: string): boolean {
  const ta = new Set(a.split(" ")), tb = new Set(b.split(" "));
  return [...ta].every((t) => tb.has(t)) || [...tb].every((t) => ta.has(t));
}

const yabanciSahip = (u: Uygulama, copyright?: string) => {
  const s = sahip(copyright);
  return s && !kendiMarkasi(u, s) ? s : "";
};

function yabanciCopyright(v: Veri): Bulgu[] {
  const bulgular: Bulgu[] = [];
  const kayit = v.uygulamalar
    .map((u) => ({ u, s: yabanciSahip(u, guncelCopyright(u)) }))
    .filter((x) => x.s);
  const gruplar = grupla(kayit, (a, b) => ayniSahip(a.s, b.s), 1);

  if (gruplar.length >= 2) {
    const sirali = gruplar.sort((a, b) => b.length - a.length || a[0].s.localeCompare(b[0].s));
    const hesabin = sirali[0][0].s;
    for (const grup of sirali.slice(1)) {
      for (const { u, s } of grup) {
        const hedef = u.hedefSurumId;
        const engel = u.hedefSurumDuzenlenebilir && hedef
          ? undefined
          : "Düzenlenebilir sürüm yok — App Store Connect'te yeni sürüm aç, sonra tekrar dene.";
        bulgular.push({
          id: bulguId("yabanci-copyright", u.id, "sahip"),
          kural: "yabanci-copyright",
          // Tek başına zayıf sinyal: ekip üyesi ya da eski şirket adı da olabilir.
          ciddiyet: "orta",
          uygulama: tekil(u),
          baslik: `Copyright hesabın geri kalanından farklı bir sahip gösteriyor: "${guncelCopyright(u)}"`,
          neden:
            "Hesaptaki uygulamaların copyright sahipleri farklı (uygulamanın kendi adı sayılmadı). Tek başına zayıf bir " +
            "sinyal, ama satın alınmış ya da kopyalanmış kaynak kodun veya hesabın başkalarına kiralandığının tipik izidir. " +
            "Apple 5.2.1 (başkasının fikri mülkiyeti) ve 5.6.2 (doğru geliştirici kimliği) kapsamında red, uygulama " +
            "kaldırma ve hesap incelemesi uygulayabilir.",
          kanit: { bu_uygulamadaki: guncelCopyright(u), sahip: s, hesabin_cogunlugu: hesabin, farkli_sahip_sayisi: gruplar.length },
          adimlar: [
            "Copyright alanını kendi adın ya da şirketinle güncelle (ör. © 2026 Adın Soyadın).",
            "Kod satın alındıysa lisansın yayın hakkı verdiğini belgele; gerekirse inceleme notlarında açıkla.",
            "Uygulama başkasına aitse onu bu hesapta yayınlama — gerçek sahibine App Store Connect'ten transfer et.",
          ],
          duzeltme: {
            gerekenDeger: "copyright metni (ör. © 2026 Adın Soyadın)",
            ...(engel ? { engel } : {}),
            degisim: [{ alan: "copyright", simdi: guncelCopyright(u), yeni: "<senin değerin>" }],
            istekler: (deger) => {
              if (engel || !hedef) return [];
              const metin = (deger ?? "").trim();
              if (!metin) throw new Error("Copyright metni boş olamaz.");
              return [{
                yontem: "PATCH",
                yol: `/v1/appStoreVersions/${encodeURIComponent(hedef)}`,
                govde: { data: { type: "appStoreVersions", id: hedef, attributes: { copyright: metin } } },
              }];
            },
          },
        });
      }
    }
  }

  for (const u of v.uygulamalar) {
    const gecmis = (u.surumler ?? []).filter((s) => yabanciSahip(u, s.copyright));
    if (grupla(gecmis, (a, b) => ayniSahip(sahip(a.copyright), sahip(b.copyright)), 1).length < 2) continue;
    bulgular.push({
      id: bulguId("yabanci-copyright", u.id, "degisim"),
      kural: "yabanci-copyright",
      ciddiyet: "orta",
      uygulama: tekil(u),
      baslik: "Copyright sahibi sürümler arasında değişmiş",
      neden:
        "5.6.2: Apple geliştirici kimliğinin doğru ve tutarlı olmasını ister. Sürümden sürüme değişen sahip, uygulamanın el " +
        "değiştirdiğini ya da hesabın başkası adına kullanıldığını düşündürür ve hesap incelemesini tetikleyebilir.",
      kanit: { surumler: gecmis.map((s) => `${s.surum}: ${s.copyright}`) },
      adimlar: [
        "Uygulama sana aitse tüm gelecek sürümlerde tek ve doğru sahibi kullan.",
        "Uygulama el değiştirdiyse Apple'ın resmi uygulama transferini kullan; copyright'ı elle değiştirerek devralma yapma.",
      ],
    });
  }
  return bulgular;
}

// ─── toplu-yayin ─────────────────────────────────────────────────────────

function topluYayin(v: Veri): Bulgu[] {
  const ilk = v.uygulamalar
    .map((u) => ({ u, t: Math.min(...(u.surumler ?? []).map((s) => Date.parse(s.olusturma)).filter(Number.isFinite)) }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t);
  let en = { bas: 0, son: -1 };
  for (let i = 0, j = 0; j < ilk.length; j++) {
    while (ilk[j].t - ilk[i].t > 30 * GUN) i++;
    if (j - i > en.son - en.bas) en = { bas: i, son: j };
  }
  const pencere = ilk.slice(en.bas, en.son + 1);
  if (pencere.length < 5) return [];
  const tarih = (t: number) => new Date(t).toISOString().slice(0, 10);
  return [{
    id: bulguId("toplu-yayin", undefined, tarih(pencere[0].t)),
    kural: "toplu-yayin",
    ciddiyet: pencere.length >= 10 ? "yuksek" : "orta",
    baslik: `30 gün içinde ${pencere.length} yeni uygulama açılmış`,
    neden:
      "Kısa sürede çok sayıda uygulama göndermek Apple'ın spam ve uygulama fabrikası sinyallerinden biridir; bu hesaplar " +
      "genelde genişletilmiş incelemeye alınır. " + SPAM_SONUCU,
    kanit: { pencere: `${tarih(pencere[0].t)} → ${tarih(pencere[pencere.length - 1].t)}`, uygulamalar: pencere.map((x) => x.u.ad) },
    adimlar: [
      "Yeni uygulamaları aralıklı gönder; her birinin gerçekten farklı bir ihtiyaca cevap verdiğinden emin ol.",
      "Benzer fikirleri ayrı uygulamalar yerine tek uygulamanın özellikleri olarak geliştir.",
    ],
  }];
}

export function klonKurallari(v: Veri): Bulgu[] {
  return [
    ...ekranGoruntusu(v),
    ...isimKlonu(v),
    ...aciklamaKlonu(v),
    ...siraliBundle(v),
    ...doymusKategori(v),
    ...yabanciCopyright(v),
    ...topluYayin(v),
  ];
}
