/**
 * Hesap sağlığı analizinin ortak sözleşmesi.
 *
 * topla.ts → Veri üretir (ağ). kurallar/*.ts → Veri'den Bulgu üretir (saf,
 * ağsız, test edilebilir). duzelt.ts → Bulgu.duzeltme'yi çalıştırır.
 */
import type { Istek } from "../../istemci/apple.js";

export type Ciddiyet = "kritik" | "yuksek" | "orta" | "dusuk";
export type Bolum = "klon" | "metadata" | "yorum_para" | "inceleme_hesap";
export const BOLUMLER: Bolum[] = ["klon", "metadata", "yorum_para", "inceleme_hesap"];

/** Her kuralın bölümü ve dayandığı Apple maddesi. Kural id'leri bulgu id'lerinin önekidir. */
export const KURALLAR = {
  // klon — kurallar/klon.ts
  "klon-ekran-goruntusu": { bolum: "klon", madde: "4.3(a) Spam, 4.1 Kopya" },
  "klon-isim": { bolum: "klon", madde: "4.3(a) Spam" },
  "klon-aciklama": { bolum: "klon", madde: "4.3(a) Spam, 4.2.6 Şablon uygulama" },
  "sirali-bundle": { bolum: "klon", madde: "4.3(a) Spam" },
  "doymus-kategori": { bolum: "klon", madde: "4.3(b) Doymuş kategori" },
  "yabanci-copyright": { bolum: "klon", madde: "5.2.1 Fikri mülkiyet, 5.6.2 Geliştirici kimliği" },
  "toplu-yayin": { bolum: "klon", madde: "4.3 Spam" },
  // metadata — kurallar/metadata.ts
  "anahtar-marka": { bolum: "metadata", madde: "2.3.7 Metadata, 5.2.1 Ticari marka" },
  "isim-marka": { bolum: "metadata", madde: "2.3.7, 4.1(c), 5.2.5 Apple markaları" },
  "isim-yasak-ifade": { bolum: "metadata", madde: "2.3.7 Metadata" },
  "anahtar-tekrar": { bolum: "metadata", madde: "2.3.7 Metadata" },
  "kelime-doldurma": { bolum: "metadata", madde: "2.3.7 Metadata" },
  "aciklama-platform": { bolum: "metadata", madde: "2.3.10 Başka platform" },
  "gizlilik-url-yok": { bolum: "metadata", madde: "5.1.1(i) Gizlilik politikası" },
  "destek-url-yok": { bolum: "metadata", madde: "1.5 Geliştirici bilgisi, 2.1" },
  "medya-indirici": { bolum: "metadata", madde: "5.2.3 Ses/görüntü indirme" },
  "sahte-islev": { bolum: "metadata", madde: "1.1.6 Yanıltıcı işlev, 2.3.1" },
  "regule-alan": { bolum: "metadata", madde: "5.1.1(ix), 5.4 VPN, 3.1.5 Kripto, 3.2.2(ix) Kredi" },
  "konsept-degisimi": { bolum: "metadata", madde: "DPLA 11.2(g), 2.3.1 Bait-and-switch" },
  // yorum & para — kurallar/yorum-para.ts
  "sikayet-yorum": { bolum: "yorum_para", madde: "5.6.4 Uygulama kalitesi, 3.1.2 Abonelik" },
  "yildiz-patlamasi": { bolum: "yorum_para", madde: "5.6.3 Keşif sahtekârlığı, DPLA 3.2(f)" },
  "kopya-yorum": { bolum: "yorum_para", madde: "5.6.1 Sahte yorum, DPLA 3.2(f)" },
  "yaniltici-yanit": { bolum: "yorum_para", madde: "5.6.1 Yorum manipülasyonu" },
  "iade-orani": { bolum: "yorum_para", madde: "5.6.4 Aşırı iade" },
  "indirme-yok": { bolum: "yorum_para", madde: "App Store Improvements (kaldırma)" },
  "fiyat-anomalisi": { bolum: "yorum_para", madde: "3.1.1 Mantıksız fiyat, 3.1.2(a)" },
  "iap-sorunlu": { bolum: "yorum_para", madde: "3.1.1 Uygulama içi satın alma" },
  // inceleme geçmişi & hesap — kurallar/inceleme-hesap.ts
  "red-gecmisi": { bolum: "inceleme_hesap", madde: "Tekrarlayan red, 4.3(b)" },
  "uzun-bekleyen-inceleme": { bolum: "inceleme_hesap", madde: "Genişletilmiş inceleme" },
  "apple-kaldirdi": { bolum: "inceleme_hesap", madde: "Apple tarafından kaldırma" },
  "eski-uygulama": { bolum: "inceleme_hesap", madde: "App Store Improvements (kaldırma)" },
  "isim-isgali": { bolum: "inceleme_hesap", madde: "DPLA 3.2(f) İsim işgali" },
  "trader-durumu": { bolum: "inceleme_hesap", madde: "AB DSA Trader durumu" },
  "bolge-engeli": { bolum: "inceleme_hesap", madde: "Bölge satış engeli" },
  "icerik-hakki-yok": { bolum: "inceleme_hesap", madde: "5.2.2 Üçüncü taraf içerik" },
  "sifreleme-beyani-yok": { bolum: "inceleme_hesap", madde: "İhracat uyumu (şifreleme)" },
  "demo-hesap-eksik": { bolum: "inceleme_hesap", madde: "2.1 Uygulama bütünlüğü" },
  "inceleme-notu-bos": { bolum: "inceleme_hesap", madde: "2.3.1(a), 2.3.12 İnceleme notları" },
  "yanlis-beyan": { bolum: "inceleme_hesap", madde: "DPLA 3.2(f), 2.3.6 Yanıltıcı beyan" },
  "yas-anketi-eksik": { bolum: "inceleme_hesap", madde: "2.3.6 Yaş derecelendirmesi" },
  "fazla-admin": { bolum: "inceleme_hesap", madde: "Hesap güvenliği" },
} as const satisfies Record<string, { bolum: Bolum; madde: string }>;

export type KuralId = keyof typeof KURALLAR;

/** Bulgu id'si deterministik: aynı veriyle her taramada aynı çıkar; hesap_duzelt buna güvenir. */
export function bulguId(kural: KuralId, uygulamaId?: string, ek?: string): string {
  return [kural, uygulamaId ?? "hesap", ek].filter(Boolean).join(":");
}

export type Duzeltme = {
  /** Varsa kullanıcıdan istenecek değerin tarifi ("gizlilik politikası URL'si" gibi). */
  gerekenDeger?: string;
  /** Doluysa düzeltme şu an yapılamaz (ör. düzenlenebilir sürüm yok) — sebebi. */
  engel?: string;
  /** Önizleme. Değere bağlıysa `yeni` "<senin değerin>" olur. */
  degisim: { alan: string; simdi: unknown; yeni: unknown }[];
  /** Uygulanacak istekler. gerekenDeger varsa deger dolu gelir. */
  istekler: (deger?: string) => Istek[];
};

export type Bulgu = {
  id: string;
  kural: KuralId;
  ciddiyet: Ciddiyet;
  uygulama?: { id: string; ad: string };
  /** Tek cümle, sade Türkçe. */
  baslik: string;
  /** Apple neden kızar, en kötü ne olur (red / kaldırma / hesap kapatma / uzun inceleme). */
  neden: string;
  /** Kısa kanıt — tetikleyen kelimeler, ilgili uygulamalar, sayılar. Büyük veri koyma. */
  kanit: unknown;
  /** Elle çözüm adımları (otomatik düzeltme olsa bile yaz). */
  adimlar: string[];
  /** Varsa hesap_duzelt bu bulguyu düzeltebilir. Ağır müdahalelerde (satıştan kaldırma, rol düşürme) KOYMA. */
  duzeltme?: Duzeltme;
};

// ─── Toplanan veri ────────────────────────────────────────────────────────

export type BilgiYerel = {
  id: string; // appInfoLocalizations id
  dil: string;
  ad: string;
  altBaslik?: string;
  gizlilikUrl?: string;
};

export type AppInfo = {
  id: string;
  durum: string; // AppInfo.state
  duzenlenebilir: boolean; // KILITLI_DURUMLAR dışında mı
  kategori?: string; // primaryCategory id (ör. "PHOTO_AND_VIDEO")
  yerel: BilgiYerel[];
};

export type SurumYerel = {
  id: string; // appStoreVersionLocalizations id
  dil: string;
  aciklama?: string;
  anahtarKelimeler?: string;
  tanitimMetni?: string;
  yenilikler?: string;
  destekUrl?: string;
  pazarlamaUrl?: string;
};

export type Surum = {
  id: string;
  surum: string; // versionString
  durum: string; // appVersionState (yoksa appStoreState)
  magazaDurumu?: string; // appStoreState — REMOVED_FROM_SALE yalnızca burada
  olusturma: string; // createdDate ISO
  copyright?: string;
  platform?: string;
};

export type Yorum = {
  id: string;
  puan: number;
  baslik?: string;
  metin?: string;
  takmaAd?: string;
  tarih: string; // ISO
  ulke?: string;
  yanit?: string; // yayımlanmış geliştirici yanıtı
};

export type Urun = {
  id: string;
  ad: string;
  tur: "iap" | "abonelik";
  durum: string;
  periyot?: string; // ONE_WEEK, ONE_MONTH, ONE_YEAR…
  abdFiyat?: number; // USD, ABD fiyatı biliniyorsa
};

export type Uygulama = {
  id: string;
  ad: string;
  bundleId: string;
  anaDil: string;
  icerikHaklari: string | null; // contentRightsDeclaration
  cocuklaraYonelik?: boolean;
  bilgiler: AppInfo[]; // 1 ya da 2 (yayındaki + hazırlanan)
  surumler: Surum[]; // yeni → eski, en çok ~20
  /** surumYerel/ekranGoruntuleri/incelemeDetayi'nın ait olduğu sürüm: düzenlenebilir varsa o, yoksa yayındaki. */
  hedefSurumId?: string;
  hedefSurumDuzenlenebilir: boolean;
  surumYerel: SurumYerel[];
  ekranGoruntuleri: { dil: string; checksum: string; tur: string }[];
  incelemeDetayi?: {
    id: string;
    notlar?: string;
    demoGerekli?: boolean;
    demoAd?: string;
    demoSifre?: string;
    eposta?: string;
  } | null;
  gonderimler: { id: string; durum: string; tarih?: string }[]; // reviewSubmissions
  yorumlar: Yorum[];
  urunler: Urun[];
  buildler: { id: string; surum: string; yuklenme: string; sifreleme: boolean | null; durum: string }[];
  /** territoryAvailabilities contentStatuses → o durumdaki ülkeler. */
  bolgeDurumlari: Record<string, string[]>;
  /** ageRatingDeclaration özellikleri (ham). */
  yasBeyani?: { id: string; ozellikler: Record<string, unknown> } | null;
};

export type Veri = {
  /** Analizin "şimdi"si — testler sabitler. ISO. */
  simdi: string;
  derin: boolean;
  uygulamalar: Uygulama[];
  kullanicilar: { id: string; roller: string[]; tumUygulamalar: boolean }[];
  davetler: { id: string; roller: string[]; bitis?: string }[];
  /** Geçen ayın satış özeti: Apple uygulama id → birim / iade (negatif birimlerin mutlak toplamı). */
  satis?: { donem: string; uygulamalar: Record<string, { birim: number; iade: number }> };
  /** Son 12 ay (yıllık rapor) indirme birimi, Apple uygulama id → birim. */
  yillikIndirme?: Record<string, number>;
  /** Toplanamayan parçalar: anahtar → hata mesajı. Kurallar eksik veriye dayanıklı olmalı. */
  hatalar: Record<string, string>;
};

export type KuralSeti = (v: Veri) => Bulgu[];
