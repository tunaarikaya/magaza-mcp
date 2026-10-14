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

/** Sahte/teşvikli yorum sinyallerinde ortak sessiz düzeltme adımları. */
const TESVIK_ADIMLAR = [
  "Puan karşılığı ödül / deneme / kilit açma veren bir akışın olduysa kodu bir sonraki sürümde TAMAMEN kaldır — uzaktan (remote config) kapatmak yetmez, binary'de duran kapalı özellik 2.3.1 'gizli özellik' sayılabilir.",
  "Kaldırdığın tarihi ve sürümü kendine not et — yalnızca Apple sorarsa kullanmak için.",
  "Bundan sonra puanı yalnızca SKStoreReviewController ile iste, hiçbir ödüle bağlama.",
  "Apple sorarsa kısa ve dürüst cevap ver: ne vardı, ne zaman kaldırıldı.",
];
const TESVIK_YAPMA = [
  "Bu yorumları 'Sorun bildir' ile raporlama ya da 'rakip/bot bastı' deme — Apple zaten görüyor; o yorumların bir kısmı kendi teşvik akışından geldiyse bu yanlış beyan olur ve durumu ağırlaştırır.",
  "Yeni yorum kampanyası, yorum değişim grubu, ödüllü puan isteme.",
  "Apple'a kendiliğinden açıklama ya da itiraf yazma.",
];

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
        "Apple şikâyet ve iade yoğunluğunu izler (5.6.4); bu oran yükselirse uygulama ve hesap incelemeye girebilir." +
        (abonelik * 2 >= eslesen.length
          ? " Şikâyetlerin çoğu iptal edememe / deneme sonrası ücret üzerine — Apple bunu abonelik şeffaflığı (3.1.2) sorunu olarak okur."
          : ""),
      kanit: {
        sayi: eslesen.length,
        oran: yuzde(oran),
        yanitsiz,
        ornekler: eslesen.slice(0, 3).map((y) => kisalt(yorumMetni(y))),
      },
      adimlar: [
        `Yanıtsız ${yanitsiz} şikâyeti appstore__yorum_yanitla ile tek tek, sakin ve yardımcı bir dille yanıtla; iadenin reportaproblem.apple.com'dan istendiğini göster, söz verme.`,
        "Bir sonraki güncellemede paywall'da fiyatı, deneme süresini ve deneme bitince ne kadar ücret alınacağını açıkça yaz; iptal yolunu (Ayarlar → Abonelikler) göster.",
        "Şikâyetlerdeki ortak sebebi (çalışmayan özellik, kafa karıştıran fiyat) aynı güncellemede düzelt.",
      ],
      yapma: [
        "Şikâyetçiye 'puanını değiştir' deme, karşılığında premium/hediye teklif etme.",
        "Kopyala-yapıştır aynı yanıtı yüzlerce yoruma basma.",
        "Kötü yorumları raporlayarak kaldırtmaya çalışma.",
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
      baslik:
        `${patlama.length} günde olağandışı 5 yıldız yığılması (en yoğun: ` +
        [...patlama].sort((a, b) => b.sayi - a.sayi).slice(0, 2).map((p) => `${p.gun}: ${p.sayi}`).join(", ") + ")",
      neden:
        "Apple ani puan patlamalarını otomatik izler ve teşvikli / satın alınmış yorum işareti sayar (5.6.3, DPLA 3.2(f)); " +
        "2025'te 195 milyon sahte puanı engelledi. Kim yazdıysa yazsın, sinyal senin uygulamanda görünür. " +
        "Organik bir viral ya da lansman da olabilir; ödüllü puan akışı ya da yorum kampanyası varsa risklidir.",
      kanit: { gunler: patlama, gunluk_medyan: m },
      adimlar: [
        "O tarihte reklam, kampanya ya da influencer paylaşımı var mıydı kendin kontrol et; organikse yapacak bir şey yok.",
        ...TESVIK_ADIMLAR,
      ],
      yapma: TESVIK_YAPMA,
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
        "Aynı metnin farklı hesaplardan gelmesi Apple'ın sahte yorum tespitinin en net yakaladığı izdir; 5.6.1 ve DPLA 3.2(f) " +
        "('sahte yorum göndermek') kapsamındadır ve hesap kapatma bildirimlerinde bire bir geçer. Kim yazdıysa yazsın, sinyal " +
        "senin uygulamanda görünür. Bu yorumları sen silemezsin; Apple gerekirse kendisi temizler.",
      kanit: kopyalar.slice(0, 3).map((g) => ({ ornek: kisalt(g.ornek), adet: g.adlar.size, takma_adlar: [...g.adlar].slice(0, 5) })),
      adimlar: TESVIK_ADIMLAR,
      yapma: TESVIK_YAPMA,
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
        "O yanıtları düzenle (yanıt düzenlenebilir, appstore__yorum_yanitla ile üzerine yaz) — ödül / puan değişimi ifadesini çıkar, yalnızca sorunu çözmeye odaklan.",
        "Destek ekibine de puan karşılığı ödül teklif etmemesini söyle.",
      ],
      yapma: [
        "Yanıtı silip aynı teklifi DM / e-posta ile yapma.",
        "Apple'a kendiliğinden açıklama yazma; yanıtı düzeltmek yeterli.",
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
        oran >= 0.05
          ? "5.6.4 'aşırı oranda iade talebi'ni hesap kapatma sebepleri arasında sayar. Yüksek iade, kullanıcıların yanıltıldığını düşündüğünü gösterir."
          : "İade oranı normalin üstünde (5.6.4); kullanıcıların bir kısmı ne aldığını satın almadan önce tam anlamıyor olabilir.",
      kanit: { donem: v.satis!.donem, birim: s.birim, iade: s.iade, oran: yuzde(oran) },
      adimlar: [
        "Bir sonraki güncellemede paywall'daki fiyat / deneme / yenileme metnini netleştir; kullanıcı ne ödeyeceğini satın almadan önce görmeli.",
        "Şikâyet yorumlarındaki ortak sebebi bul ve aynı güncellemede düzelt.",
        "Reklamlarında ve ekran görüntülerinde uygulamada olmayan özellik vaat etme.",
      ],
      yapma: [
        "İadeleri engellemeye ya da kullanıcıyı iade istememeye ikna etmeye çalışma.",
        "Apple'a yazıp iadeleri açıklamaya çalışma; düzeltme paywall'da yapılır.",
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
        "güncellenmezse uygulamayı kaldırır. Bu bir ceza değil, bakım temizliği — ama ölü uygulama birikmesi hesaba iyi görünmez.",
      kanit: { yillik_birim: birim },
      adimlar: [
        "Yaşatacaksan güncel SDK ile normal bir güncelleme gönder.",
        "Yaşatmayacaksan Apple'ın bildirimini beklemeden App Store Connect → Fiyatlandırma ve Kullanılabilirlik'ten kendin satıştan kaldır (araç bunu yapmaz).",
      ],
      yapma: [
        "Bildirim gelirse Apple'a yazıp 'kaldırmayın' deme; ya güncelle ya kaldırılmasına izin ver.",
        "Sırf indirme göstermek için sahte indirme / yorum alma.",
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
        ciddiyet === "yuksek"
          ? "Apple 'mantıksız derecede yüksek fiyatları' reddeder (3.1.1) ve kullanıcıyı pahalı plana iten yapıyı 'bait-and-switch' olarak inceler (3.1.2(a)). Bu planlar iade ve şikâyetin de ana kaynağıdır."
          : "Pahalı haftalık planlar inceleme sırasında red sebebi olabilir (3.1.1) ve iade / şikâyetin sık kaynağıdır.",
      kanit: sebepler,
      adimlar: [
        "Haftalık planı aylık karşılığından belirgin ucuz tut ya da kaldır; uzun plan her zaman birim başına daha ucuz olmalı.",
        "Fiyatı appstore__fiyat_analizi / appstore__abonelik_fiyat_ayarla ile sessizce yeniden ayarla — fiyat değişikliği inceleme gerektirmez.",
        "Bir sonraki güncellemede paywall'da varsayılan seçili planın fiyatını ve periyodunu en büyük yazıyla göster.",
      ],
      yapma: [
        "Paywall'da haftalık fiyatı küçük yazıp 'günlük sadece X' gibi bölünmüş fiyatı öne çıkarma.",
        "Apple'a fiyatı açıklayan mesaj yazma; düzelt, yeter.",
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
        "Reddedilmiş ya da eksik IAP'ler sürüm gönderimini takar; eksikle gönderilen sürüm reddedilir ve red geçmişi sonraki incelemeleri yavaşlatır.",
      kanit: [...agir, ...eksik].map((p) => ({ ad: p.ad, tur: p.tur, durum: p.durum })),
      adimlar: [
        "Her ürüne inceleme ekran görüntüsü (satın alma ekranı) ve tüm dillerde ad + açıklama ekle.",
        "Ürünün uygulamada nerede bulunduğunu inceleme notuna adım adım yaz.",
        "Reddedilen ürünün App Store Connect'teki mesajını oku, düzelt ve ürünü bir sonraki normal sürümle birlikte gönder.",
      ],
      yapma: [
        "Ürünleri eksik haliyle sürüme ekleyip 'bakalım geçer mi' diye gönderme.",
        "Red mesajını düzeltmeden aynı ürünü tekrar gönderme.",
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
