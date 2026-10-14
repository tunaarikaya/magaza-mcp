import { bulguId, type Bulgu, type Uygulama, type Veri, type Yorum } from "../tip.js";

/** Türkçe I/İ/ı farkı eşleşmeyi bozmasın: hepsi "i" olur, sonra küçük harf. */
const norm = (s?: string) => (s ?? "").replace(/[İIı]/g, "i").toLowerCase();

const SIKAYET = [
  "scam", "fraud", "rip off", "ripoff", "refund", "charged", "can't cancel", "cannot cancel",
  "unsubscribe", "stole", "steal", "fake", "hidden charge",
  "dolandırıcı", "dolandırıcılık", "para iade", "iade", "iptal edemiyorum", "çaldı", "sahte", "habersiz ücret",
  "estafa", "reembolso", "betrug", "abzocke", "arnaque", "remboursement", "golpe",
  "мошенники", "развод", "احتيال",
].map(norm);

/** Abonelik şeffaflığı (3.1.2) şikâyeti sayılan kalıplar. */
const ABONELIK = [
  "can't cancel", "cannot cancel", "unsubscribe", "charged", "hidden charge", "trial",
  "iptal edemiyorum", "habersiz ücret", "deneme",
].map(norm);

/** Tek başına yeten açık teşvik kalıpları. */
const TESVIK = [
  "change your rating", "update your review", "5 stars and", "rate us 5", "free premium if",
  "puanını değiştir", "yorumunu güncelle", "5 yıldız ver",
].map(norm);

/** Genel ödül kelimeleri — yalnızca aynı yanıtta puan bağlamı da varsa teşvik sayılır (deneme süresi anlatımı değil). */
const ODUL = ["hediye", "ücretsiz premium", "free premium", "gift", "reward", "bonus"].map(norm);
const PUAN_BAGLAMI = ["puan", "yıldız", "yorumunu", "değerlendirme", "rating", "review", "stars", "rate"].map(norm);

function tesvikMi(yanit: string): boolean {
  const n = norm(yanit);
  return TESVIK.some((t) => n.includes(t)) || (ODUL.some((t) => n.includes(t)) && PUAN_BAGLAMI.some((t) => n.includes(t)));
}

const kisalt = (s: string) => (s.length > 120 ? s.slice(0, 117) + "…" : s);
const yorumMetni = (y: Yorum) => [y.baslik, y.metin].filter(Boolean).join(" — ");
const uyg = (u: Uygulama) => ({ id: u.id, ad: u.ad });
const yuzde = (x: number) => `%${(x * 100).toFixed(1)}`;

function sikayetYorum(u: Uygulama): Bulgu[] {
  const eslesen = u.yorumlar.filter((y) => SIKAYET.some((t) => norm(yorumMetni(y)).includes(t)));
  if (eslesen.length < 3) return [];
  const oran = eslesen.length / u.yorumlar.length;
  const abonelik = eslesen.filter((y) => ABONELIK.some((t) => norm(yorumMetni(y)).includes(t))).length;
  const yanitsiz = eslesen.filter((y) => !y.yanit).length;
  return [
    {
      id: bulguId("sikayet-yorum", u.id),
      kural: "sikayet-yorum",
      ciddiyet: eslesen.length >= 5 && oran >= 0.1 ? "yuksek" : "orta",
      uygulama: uyg(u),
      baslik: `Son ${u.yorumlar.length} yorumun ${eslesen.length} tanesi dolandırıcılık / iade / ücret şikâyeti`,
      neden:
        "Apple şikâyet ve iade talebi yoğunluğunu izler; 5.6.4'e göre aşırı şikâyet ve iade hesabın kapatılma sebebidir." +
        (abonelik * 2 >= eslesen.length
          ? " Şikâyetlerin çoğu iptal edememe / deneme sonrası habersiz ücret üzerine — bu 3.1.2 abonelik şeffaflığı ihlali olarak okunur ve 'bait-and-switch' sayılabilir."
          : ""),
      kanit: {
        sayi: eslesen.length,
        oran: yuzde(oran),
        yanitsiz,
        ornekler: eslesen.slice(0, 3).map((y) => kisalt(yorumMetni(y))),
      },
      adimlar: [
        `Yanıtsız ${yanitsiz} şikâyeti appstore__yorum_yanitla ile yanıtla; iadeyi nasıl isteyeceklerini (reportaproblem.apple.com) anlat, yanıltıcı söz verme.`,
        "Paywall'da fiyatı, deneme süresini ve deneme bitince ne kadar ücret alınacağını açıkça yaz; iptal yolunu (Ayarlar → Abonelikler) göster.",
        "Şikâyetlerdeki ortak sebebi (çalışmayan özellik, kafa karıştıran fiyat) bir sonraki sürümde düzelt.",
      ],
    },
  ];
}

function medyan(dizi: number[]): number {
  const s = [...dizi].sort((a, b) => a - b);
  const o = Math.floor(s.length / 2);
  return s.length % 2 ? s[o] : (s[o - 1] + s[o]) / 2;
}

function yildizPatlamasi(u: Uygulama): Bulgu[] {
  const gunluk = new Map<string, number>();
  for (const y of u.yorumlar) if (y.puan === 5) gunluk.set(y.tarih.slice(0, 10), (gunluk.get(y.tarih.slice(0, 10)) ?? 0) + 1);
  if (gunluk.size === 0) return [];
  // Medyan yorum aralığındaki tüm günlerle (sıfırlı günler dahil) hesaplanır; yoksa patlama kendi medyanı olur.
  const gunler = u.yorumlar.map((y) => Date.parse(y.tarih.slice(0, 10)));
  const ilk = Math.min(...gunler);
  const son = Math.max(...gunler);
  const sayilar: number[] = [];
  for (let t = ilk; t <= son; t += 86_400_000) sayilar.push(gunluk.get(new Date(t).toISOString().slice(0, 10)) ?? 0);
  const m = medyan(sayilar);
  const patlama = [...gunluk].filter(([, n]) => n >= 10 && n >= 5 * m).map(([gun, sayi]) => ({ gun, sayi }));
  if (!patlama.length) return [];
  return [
    {
      id: bulguId("yildiz-patlamasi", u.id),
      kural: "yildiz-patlamasi",
      ciddiyet: "yuksek",
      uygulama: uyg(u),
      baslik: `Tek günde olağandışı 5 yıldız yığılması (${patlama.map((p) => `${p.gun}: ${p.sayi}`).join(", ")})`,
      neden:
        "Apple ani puan patlamalarını satın alınmış / teşvikli yorum sayar (5.6.3, DPLA 3.2(f)); 2025'te 195 milyon sahte puanı engelledi. " +
        "Kanıtlanırsa yorumlar silinir, hesap 'Pending Termination' alabilir. Bu organik bir viral ya da lansman da olabilir; " +
        "ödüllü/teşvikli yorum kampanyası yaptıysan risklidir.",
      kanit: { gunler: patlama, gunluk_medyan: m },
      adimlar: [
        "O tarihte reklam, kampanya ya da influencer paylaşımı var mıydı kontrol et.",
        "Yorum satın aldıysan, yorum değişimi gruplarına katıldıysan ya da puan karşılığı ödül verdiysen hemen bırak.",
        "Puan istemeyi yalnızca SKStoreReviewController ile yap; ödül, hediye ya da kilit açma karşılığı puan isteme.",
        "Patlama bir kampanya / basın haberinden geldiyse bunu bir yere not et — itirazda kanıt olur.",
      ],
    },
  ];
}

function kelimeler(s: string): Set<string> {
  return new Set(norm(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let ortak = 0;
  for (const k of a) if (b.has(k)) ortak++;
  return ortak / (a.size + b.size - ortak);
}

function kopyaYorum(u: Uygulama): Bulgu[] {
  // sınır: açgözlü kümeleme, temsilciye karşı O(n²); 1000 yorumda sorun değil, daha fazlasında MinHash
  const gruplar: { temsil: Set<string>; ornek: string; adlar: Set<string> }[] = [];
  for (const y of u.yorumlar) {
    const metin = (y.metin ?? "").trim();
    if (metin.length < 20) continue;
    const k = kelimeler(metin);
    if (k.size < 4) continue;
    const ad = y.takmaAd || `#${y.id}`;
    const g = gruplar.find((g) => jaccard(g.temsil, k) >= 0.8);
    if (g) g.adlar.add(ad);
    else gruplar.push({ temsil: k, ornek: metin, adlar: new Set([ad]) });
  }
  const kopyalar = gruplar.filter((g) => g.adlar.size >= 2).sort((a, b) => b.adlar.size - a.adlar.size);
  if (!kopyalar.length) return [];
  return [
    {
      id: bulguId("kopya-yorum", u.id),
      kural: "kopya-yorum",
      ciddiyet: kopyalar[0].adlar.size >= 3 ? "kritik" : "yuksek",
      uygulama: uyg(u),
      baslik: `Farklı kullanıcılardan aynı/çok benzer yorum metinleri (${kopyalar.length} grup)`,
      neden:
        "Aynı metnin farklı hesaplardan gelmesi sahte yorumun en net izidir. Apple bunu 5.6.1 ve DPLA 3.2(f) ('sahte yorum göndermek') " +
        "kapsamında doğrudan hesap kapatma sebebi sayar.",
      kanit: kopyalar.slice(0, 3).map((g) => ({ ornek: kisalt(g.ornek), adet: g.adlar.size, takma_adlar: [...g.adlar].slice(0, 5) })),
      adimlar: [
        "Yorum satın aldıysan ya da tanıdıklarına hazır metin dağıttıysan hemen durdur; bu yorumları sen silemezsin, Apple siler.",
        "Rakibin sana sahte yorum bıraktığından şüpheleniyorsan App Store Connect → Yorumlar → 'Sorun bildir' ile Apple'a raporla.",
      ],
    },
  ];
}

function yanilticiYanit(u: Uygulama): Bulgu[] {
  const eslesen = u.yorumlar.filter((y) => y.yanit && tesvikMi(y.yanit));
  if (!eslesen.length) return [];
  return [
    {
      id: bulguId("yaniltici-yanit", u.id),
      kural: "yaniltici-yanit",
      ciddiyet: "yuksek",
      uygulama: uyg(u),
      baslik: `${eslesen.length} geliştirici yanıtında puan karşılığı teşvik / puan değiştirme isteği var`,
      neden:
        "Yanıtta 'puanını değiştir, karşılığında premium/hediye' demek puan manipülasyonudur (5.6.1). Apple'ın kapatma bildirimleri " +
        "'yanıltıcı müşteri desteği yanıtları'nı ayrıca sayıyor.",
      kanit: eslesen.slice(0, 3).map((y) => kisalt(y.yanit!)),
      adimlar: [
        "Bu yanıtları appstore__yorum_yanitla ile düzenle: teşviki ve puan değiştirme isteğini çıkar, yalnızca sorunu çözmeye odaklan.",
        "Destek ekibine puan karşılığı ödül teklif etmenin yasak olduğunu bildir.",
      ],
    },
  ];
}

function iadeOrani(v: Veri, u: Uygulama): Bulgu[] {
  const s = v.satis?.uygulamalar[u.id];
  if (!s || s.birim < 50) return [];
  const oran = s.iade / s.birim;
  if (oran < 0.02) return [];
  return [
    {
      id: bulguId("iade-orani", u.id),
      kural: "iade-orani",
      ciddiyet: oran >= 0.05 ? "yuksek" : "orta",
      uygulama: uyg(u),
      baslik: `${v.satis!.donem} döneminde iade oranı ${yuzde(oran)} (${s.iade}/${s.birim})`,
      neden:
        "5.6.4 'aşırı oranda iade talebi'ni açıkça hesap kapatma sebebi sayar. Yüksek iade, kullanıcıların yanıltıldığını düşündüğünü gösterir.",
      kanit: { donem: v.satis!.donem, birim: s.birim, iade: s.iade, oran: yuzde(oran) },
      adimlar: [
        "Paywall'daki fiyat / deneme / yenileme metnini netleştir; kullanıcı ne ödeyeceğini satın almadan önce görmeli.",
        "İade yorumlarını appstore__hesap_sagligi'nın sikayet-yorum bulgusuyla birlikte incele; ortak sebebi düzelt.",
        "Reklamlarında ve ekran görüntülerinde uygulamada olmayan özellik vaat etme.",
      ],
    },
  ];
}

function indirmeYok(v: Veri, u: Uygulama): Bulgu[] {
  if (!v.yillikIndirme) return [];
  const yayinda = u.surumler.some((s) => s.durum === "READY_FOR_DISTRIBUTION" || s.magazaDurumu === "READY_FOR_SALE");
  const birim = v.yillikIndirme[u.id] ?? 0;
  if (!yayinda || birim > 10) return [];
  return [
    {
      id: bulguId("indirme-yok", u.id),
      kural: "indirme-yok",
      ciddiyet: "orta",
      uygulama: uyg(u),
      baslik: `Son 12 ayda yalnızca ${birim} indirme`,
      neden:
        "Apple 'App Store Improvements' sürecinde 12 ay boyunca neredeyse hiç indirilmeyen uygulamalara bildirim gönderir; 90 gün içinde " +
        "güncellenmezse uygulama kaldırılır. Çok sayıda ölü uygulama hesabı da 'spam' görüntüsüne iter.",
      kanit: { yillik_birim: birim },
      adimlar: [
        "Uygulamayı yaşatacaksan güncel SDK ile yeni sürüm gönder.",
        "Yaşatmayacaksan App Store Connect → Fiyatlandırma ve Kullanılabilirlik'ten kendin satıştan kaldır (araç bunu yapmaz).",
      ],
    },
  ];
}

function fiyatAnomalisi(u: Uygulama): Bulgu[] {
  const abone = u.urunler.filter((p) => p.tur === "abonelik" && p.abdFiyat != null);
  const haftalik = abone.filter((p) => p.periyot === "ONE_WEEK");
  const aylik = abone.filter((p) => p.periyot === "ONE_MONTH");
  const sebepler: string[] = [];
  let ciddiyet: "orta" | "yuksek" | undefined;

  const ucuzAylik = Math.min(...aylik.map((p) => p.abdFiyat!));
  for (const h of haftalik) {
    if (h.abdFiyat! >= ucuzAylik) {
      sebepler.push(`'${h.ad}' haftalık $${h.abdFiyat} — aylık plandan ($${ucuzAylik}) pahalı ya da eşit`);
      ciddiyet = "yuksek";
    }
  }
  for (const p of [...haftalik, ...aylik]) {
    if (p.abdFiyat! >= 99.99) {
      sebepler.push(`'${p.ad}' ${p.periyot === "ONE_WEEK" ? "haftalık" : "aylık"} $${p.abdFiyat} — uç fiyat`);
      ciddiyet = "yuksek";
    }
  }
  for (const h of haftalik) {
    if (h.abdFiyat! >= 9.99 && h.abdFiyat! < 99.99 && h.abdFiyat! < ucuzAylik) {
      sebepler.push(`'${h.ad}' haftalık $${h.abdFiyat}`);
      ciddiyet ??= "orta";
    }
  }
  if (!ciddiyet) return [];
  return [
    {
      id: bulguId("fiyat-anomalisi", u.id),
      kural: "fiyat-anomalisi",
      ciddiyet,
      uygulama: uyg(u),
      baslik: "Abonelik fiyatlarında mantıksız / yanıltıcı görünen yapı",
      neden:
        "Apple 'mantıksız derecede yüksek fiyatları' reddeder (3.1.1) ve pahalı haftalık planları, kullanıcıyı yanlışlıkla pahalı plana " +
        "iten 'bait-and-switch' örüntüsü olarak inceler (3.1.2(a)). Bu tür planlar iade ve şikâyetin de ana kaynağıdır.",
      kanit: sebepler,
      adimlar: [
        "Haftalık planı aylık karşılığından belirgin ucuz tut ya da kaldır; uzun plan her zaman birim başına daha ucuz olmalı.",
        "Paywall'da varsayılan seçili planın fiyatını ve periyodunu en büyük yazıyla göster.",
        "Fiyatı appstore__fiyat_analizi / appstore__abonelik_fiyat_ayarla ile yeniden ayarla.",
      ],
    },
  ];
}

function iapSorunlu(u: Uygulama): Bulgu[] {
  const agir = u.urunler.filter((p) => p.durum === "REJECTED" || p.durum === "DEVELOPER_ACTION_NEEDED");
  const eksik = u.urunler.filter((p) => p.durum === "MISSING_METADATA");
  if (!agir.length && !eksik.length) return [];
  return [
    {
      id: bulguId("iap-sorunlu", u.id),
      kural: "iap-sorunlu",
      ciddiyet: agir.length ? "orta" : "dusuk",
      uygulama: uyg(u),
      baslik: `${agir.length + eksik.length} uygulama içi ürün reddedilmiş ya da eksik`,
      neden:
        "Reddedilmiş ya da eksik IAP'ler sürüm gönderimini takar ve tekrarlayan redlere yol açar; tekrarlayan red hesabın inceleme " +
        "geçmişini kötüleştirir ve sonraki incelemeleri uzatır.",
      kanit: [...agir, ...eksik].map((p) => ({ ad: p.ad, tur: p.tur, durum: p.durum })),
      adimlar: [
        "Her ürüne inceleme ekran görüntüsü (satın alma ekranı) ve tüm dillerde ad + açıklama ekle.",
        "Review note'ta ürünün uygulamada nerede bulunduğunu adım adım yaz.",
        "Reddedilen ürünün App Store Connect'teki mesajını oku, düzeltip ürünü bir sonraki sürümle birlikte yeniden gönder.",
      ],
    },
  ];
}

export function yorumParaKurallari(v: Veri): Bulgu[] {
  return v.uygulamalar.flatMap((u) => [
    ...sikayetYorum(u),
    ...yildizPatlamasi(u),
    ...kopyaYorum(u),
    ...yanilticiYanit(u),
    ...iadeOrani(v, u),
    ...indirmeYok(v, u),
    ...fiyatAnomalisi(u),
    ...iapSorunlu(u),
  ]);
}
