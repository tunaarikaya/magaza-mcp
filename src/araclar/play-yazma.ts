/**
 * Google Play'de yayın ve fiyat işlerini tek araca toplayanlar.
 *
 * Play'de mağazaya dokunan her şey bir düzenleme oturumu (edit) içinde olur:
 * aç → değiştir → commit. Dispatch yoluyla model bu zinciri 6-10 çağrıda,
 * her adımda onay alarak ve edit kimliğini elle taşıyarak kuruyordu; AAB ve
 * görsel yüklemek ise hiç mümkün değildi. Buradaki araçlar zinciri sunucuda
 * koşturur, hata olursa oturumu siler — yarım kalmış değişiklik commit edilmez.
 */
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";

import { cagir, yukle } from "../istemci/play.js";
import { alimGucuVerisi, fiyatSeviyesi } from "./alim-gucu.js";
import { onayIste, onaySemasi } from "./appstore.js";
import { metin, oturumda, paketAlani, paraBicimle, sayi, yolParcasi } from "./play.js";
import type { Arac } from "./tip.js";

const taban = (paket: unknown) => `/androidpublisher/v3/applications/${yolParcasi(paket, "paket_adi")}`;

/**
 * Bir düzenleme oturumu açar, işi yapar, commit eder.
 *
 * İş yarıda düşerse oturum silinir: Play'de commit edilmemiş oturum hiçbir
 * şeyi değiştirmez, yani ya hepsi olur ya hiçbiri.
 */
async function duzenlemede<T>(
  paketAdi: unknown,
  is: (edit: string) => Promise<T>,
  incelemeyeGonder: boolean,
): Promise<T> {
  const oturum: any = await cagir({ yontem: "POST", yol: `${taban(paketAdi)}/edits` });
  if (!oturum?.id) {
    throw new Error("Düzenleme oturumu açılamadı; servis hesabının 'sürümleri yönet' yetkisi olmayabilir.");
  }
  const edit = `${taban(paketAdi)}/edits/${yolParcasi(oturum.id, "editId")}`;
  try {
    const sonuc = await is(edit);
    await cagir({
      yontem: "POST",
      yol: `${edit}:commit`,
      sorgu: incelemeyeGonder ? undefined : { changesNotSentForReview: true },
    });
    return sonuc;
  } catch (hata) {
    await cagir({ yontem: "DELETE", yol: edit }).catch(() => {});
    throw hata;
  }
}

const incelemeSemasi = {
  type: "boolean",
  description:
    "Değişiklik commit edilince otomatik incelemeye gitsin mi (varsayılan true). " +
    "'Yönetilen yayın' açık uygulamalarda false gerekir.",
};

/* ------------------------------------------------------------------ */
/* Sürüm ve kanal                                                       */
/* ------------------------------------------------------------------ */

type Surum = {
  name?: string;
  versionCodes?: string[];
  status: string;
  userFraction?: number;
  releaseNotes?: { language: string; text: string }[];
  countryTargeting?: unknown;
  inAppUpdatePriority?: number;
};

const KANAL_SEMASI = metin("Kanal: internal, alpha, beta, production ya da kapalı test kanalının adı.");

/** {"tr-TR": "...", "en-US": "..."} → Play'in releaseNotes dizisi. */
function notlarDizisi(ham: unknown): { language: string; text: string }[] | undefined {
  if (ham === undefined) return undefined;
  if (!ham || typeof ham !== "object" || Array.isArray(ham)) {
    throw new Error("notlar dil → metin nesnesi olmalı, örn. {\"tr-TR\": \"Hata düzeltmeleri\"}.");
  }
  return Object.entries(ham).map(([language, text]) => {
    const metinDeger = String(text ?? "");
    if (metinDeger.length > 500) throw new Error(`${language} notu ${metinDeger.length} karakter; Play sınırı 500.`);
    return { language, text: metinDeger };
  });
}

/** Yüzdeyi Play'in durum/oranına çevirir: 100 → completed, 0-100 arası → inProgress. */
function yuzdeDurumu(ham: unknown, taslak: boolean): Pick<Surum, "status" | "userFraction"> {
  if (taslak) return { status: "draft" };
  const yuzde = ham === undefined ? 100 : Number(ham);
  if (!Number.isFinite(yuzde) || yuzde <= 0 || yuzde > 100) throw new Error("yuzde 0'dan büyük, 100'den küçük ya da eşit olmalı.");
  return yuzde === 100 ? { status: "completed" } : { status: "inProgress", userFraction: yuzde / 100 };
}

/**
 * Yeni sürümü kanalın mevcut sürümlerine ekler.
 *
 * Tamamlanan sürüm kanaldaki her şeyin yerine geçer. Kademeli yeni sürüm ise
 * şu an herkese sunulan tamamlanmış sürümü korumalı — onu da silersek
 * kalan %90 kullanıcı hangi sürümü alacağını kaybeder ve Play reddeder.
 * Aynı türden (kademeli/durdurulmuş/taslak) eski sürüm yenisiyle değişir.
 */
function kanalaEkle(mevcut: Surum[], yeni: Surum): Surum[] {
  if (yeni.status === "completed") return [yeni];
  const degisen = yeni.status === "draft" ? ["draft"] : ["inProgress", "halted", "draft"];
  return [...mevcut.filter((s) => !degisen.includes(s.status)), yeni];
}

function ozetle(surumler: Surum[]): string[] {
  return surumler.map(
    (s) =>
      `${s.status} ${s.versionCodes?.join(",") ?? "-"}` +
      (typeof s.userFraction === "number" ? ` %${+(s.userFraction * 100).toFixed(2)}` : ""),
  );
}

async function kanalOku(edit: string, kanal: string): Promise<Surum[]> {
  try {
    const k: any = await cagir({ yontem: "GET", yol: `${edit}/tracks/${yolParcasi(kanal, "kanal")}` });
    return k.releases ?? [];
  } catch (hata) {
    // Hiç kullanılmamış kanal 404 döner; boş kanal demek.
    if (/HTTP 404/.test((hata as Error).message)) return [];
    throw hata;
  }
}

function kanalYaz(edit: string, kanal: string, surumler: Surum[]) {
  return cagir({
    yontem: "PUT",
    yol: `${edit}/tracks/${yolParcasi(kanal, "kanal")}`,
    govde: { track: kanal, releases: surumler },
  });
}

/** Kademeli (ya da durdurulmuş) sürüm; yoksa en yüksek kodlu sürüm. */
function etkinSurum(surumler: Surum[], sadeceKademeli = false): Surum | undefined {
  const kademeli = surumler.find((s) => s.status === "inProgress" || s.status === "halted");
  if (kademeli || sadeceKademeli) return kademeli;
  const enYuksek = (s: Surum) => Math.max(...(s.versionCodes ?? ["0"]).map(Number));
  return [...surumler].sort((a, b) => enYuksek(b) - enYuksek(a))[0];
}

const ISLEMLER = ["yuzde", "durdur", "devam", "tamamla", "tasi", "notlar"] as const;

/**
 * yayin_yonet'in saf hesabı: mevcut kanallardan yeni kanalları üretir.
 * Önizleme ve gerçek yazma aynı hesabı kullanır; önizlemede görülen yazılır.
 */
export function yeniKanallar(
  girdi: Record<string, any>,
  kaynak: Surum[],
  hedef: Surum[],
): { kaynak?: Surum[]; hedef?: Surum[] } {
  const islem = girdi.islem as (typeof ISLEMLER)[number];
  const klon = (s: Surum): Surum => JSON.parse(JSON.stringify(s));

  if (islem === "tasi") {
    const kaynakSurum = etkinSurum(kaynak);
    if (!kaynakSurum?.versionCodes?.length) throw new Error(`${girdi.kanal} kanalında taşınacak sürüm yok.`);
    const yeni: Surum = {
      name: kaynakSurum.name,
      versionCodes: kaynakSurum.versionCodes,
      releaseNotes: notlarDizisi(girdi.notlar) ?? kaynakSurum.releaseNotes,
      ...yuzdeDurumu(girdi.yuzde, false),
    };
    return { hedef: kanalaEkle(hedef, yeni) };
  }

  if (islem === "notlar") {
    const s = etkinSurum(kaynak);
    if (!s) throw new Error(`${girdi.kanal} kanalında sürüm yok.`);
    const yeniNotlar = notlarDizisi(girdi.notlar);
    if (!yeniNotlar?.length) throw new Error("notlar vermelisin.");
    const birlesik = new Map((s.releaseNotes ?? []).map((n) => [n.language, n.text]));
    for (const n of yeniNotlar) birlesik.set(n.language, n.text);
    return {
      kaynak: kaynak.map((x) =>
        x === s ? { ...klon(x), releaseNotes: [...birlesik].map(([language, text]) => ({ language, text })) } : x,
      ),
    };
  }

  const kademeli = etkinSurum(kaynak, true);
  if (!kademeli) {
    throw new Error(
      `${girdi.kanal} kanalında kademeli yayın yok. Yeni kademeli yayın için ` +
        "play__surum_yayinla'ya yuzde ver.",
    );
  }
  const s = klon(kademeli);
  if (islem === "durdur") s.status = "halted";
  else if (islem === "devam") s.status = "inProgress";
  else if (islem === "tamamla" || (islem === "yuzde" && Number(girdi.yuzde) === 100)) {
    s.status = "completed";
    delete s.userFraction;
    return { kaynak: [s] };
  } else if (islem === "yuzde") {
    Object.assign(s, yuzdeDurumu(girdi.yuzde, false));
    if (kademeli.status === "halted") s.status = "halted";
  }
  return { kaynak: kaynak.map((x) => (x === kademeli ? s : x)) };
}

/* ------------------------------------------------------------------ */
/* Dosyalar                                                            */
/* ------------------------------------------------------------------ */

async function dosyaBilgisi(yol: unknown, izinli: string[], ustMb: number) {
  const ham = String(yol ?? "").replace(/^~(?=\/)/, process.env.HOME ?? "~");
  const uzanti = extname(ham).toLowerCase();
  if (!izinli.includes(uzanti)) throw new Error(`${ham}: ${izinli.join(" / ")} bekleniyordu.`);
  const bilgi = await stat(ham).catch(() => undefined);
  if (!bilgi?.isFile()) throw new Error(`Dosya bulunamadı: ${ham}`);
  const mb = bilgi.size / 1024 / 1024;
  if (mb > ustMb) throw new Error(`${ham} ${mb.toFixed(1)} MB; Play sınırı ${ustMb} MB.`);
  return { yol: ham, uzanti, mb: +mb.toFixed(1) };
}

const GORSEL_TURLERI = [
  "phoneScreenshots",
  "sevenInchScreenshots",
  "tenInchScreenshots",
  "tvScreenshots",
  "wearScreenshots",
  "icon",
  "featureGraphic",
  "tvBanner",
];

/* ------------------------------------------------------------------ */
/* Fiyat                                                               */
/* ------------------------------------------------------------------ */

type Para = { currencyCode: string; units?: string; nanos?: number };

const paraSayisi = (p: Para) => Number(p.units ?? 0) + Number(p.nanos ?? 0) / 1e9;

function para(kod: string, deger: number): Para {
  const tam = Math.trunc(deger);
  return { currencyCode: kod, units: String(tam), nanos: Math.round((deger - tam) * 1e9) };
}

function fiyatSayisi(ham: unknown, alan = "fiyat"): number {
  const n = Number(String(ham ?? "").trim().replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${alan} geçerli bir sayı olmalı (örn. 9.99).`);
  return n;
}

function ondalik(kod: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: kod }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/**
 * Hesaplanmış fiyatı mağazada görülen biçime yuvarlar: 359.43 TRY → 359.99,
 * 1287 JPY → 1300, 7812 NGN → 7800. Play Apple gibi basamak dayatmıyor; yuvarlamazsak
 * 359.43 gibi garip fiyatlar çıkıyor.
 */
export function guzelFiyat(deger: number, kod: string): number {
  const basamak = ondalik(kod);
  const olcek = 10 ** (Math.floor(Math.log10(deger)) - 1);
  const yuvarlak = Math.round(deger / olcek) * olcek;
  // .99 sonu küçük fiyatlarda doğal; 80000 UZS'yi 79999.99 yapmak garip duruyor.
  return basamak > 0 && yuvarlak >= 1 && yuvarlak < 1000 ? +(yuvarlak - 10 ** -basamak).toFixed(basamak) : yuvarlak;
}

/** USD fiyatı Google'ın kuru ve yerel fiyat kalıplarıyla bütün bölgelere çevirir. */
async function bolgeFiyatlari(paket: unknown, usd: number) {
  const yanit: any = await cagir({
    yontem: "POST",
    yol: `${taban(paket)}/pricing:convertRegionPrices`,
    govde: { price: para("USD", usd) },
  });
  const bolgeler = new Map<string, Para>();
  for (const [kod, b] of Object.entries<any>(yanit.convertedRegionPrices ?? {})) bolgeler.set(kod, b.price);
  return { bolgeler, digerleri: yanit.convertedOtherRegionsPrice, surum: yanit.regionVersion?.version as string };
}

const ORNEK_BOLGELER = ["US", "TR", "DE", "GB", "FR", "JP", "BR", "IN", "CA", "AU"];

/* ------------------------------------------------------------------ */
/* Araçlar                                                             */
/* ------------------------------------------------------------------ */

export function playYazmaAraclari(): Arac[] {
  return [
    {
      ad: "play__surum_yayinla",
      aciklama:
        "AAB/APK'yı yükleyip bir kanala yayınlar, tek onayla: dosya yükle → kanala " +
        "ata → sürüm notları → commit. yuzde verilirse kademeli yayın başlar (örn. " +
        "production %10). Daha önce yüklenmiş bir sürümü yayınlamak için dosya yerine " +
        "surum_kodlari ver. Bir hata olursa hiçbir şey commit edilmez.",
      girdiSemasi: {
        type: "object",
        properties: {
          paket_adi: paketAlani,
          dosya: metin("Yüklenecek .aab veya .apk dosyasının yolu."),
          surum_kodlari: {
            type: "array",
            items: { type: "number" },
            description: "Dosya yerine: zaten yüklenmiş sürüm kodları (versionCode).",
          },
          kanal: { ...KANAL_SEMASI, description: `${KANAL_SEMASI.description} Varsayılan internal.` },
          yuzde: sayi("Kullanıcıların yüzde kaçına açılsın (1-100, varsayılan 100)."),
          notlar: {
            type: "object",
            description: "Sürüm notları, dil → metin (en fazla 500 karakter), örn. {\"tr-TR\": \"...\", \"en-US\": \"...\"}.",
            additionalProperties: { type: "string" },
          },
          taslak: { type: "boolean", description: "Taslak olarak bırak (hiç yayınlanmamış uygulamada zorunlu)." },
          incelemeye_gonder: incelemeSemasi,
          onayla: onaySemasi,
        },
        required: ["paket_adi"],
      },
      yazma: true,
      async calistir(girdi) {
        const kanal = String(girdi.kanal ?? "internal");
        const durum = yuzdeDurumu(girdi.yuzde, girdi.taslak === true);
        const notlar = notlarDizisi(girdi.notlar);
        const kodlar: string[] = Array.isArray(girdi.surum_kodlari) ? girdi.surum_kodlari.map(String) : [];
        if (!girdi.dosya && !kodlar.length) throw new Error("dosya ya da surum_kodlari vermelisin.");
        const dosya = girdi.dosya ? await dosyaBilgisi(girdi.dosya, [".aab", ".apk"], 10240) : undefined;

        if (girdi.onayla !== true) {
          return onayIste(`edits → ${kanal}`, `${girdi.paket_adi} uygulamasının ${kanal} kanalına yeni sürüm yayınlar.`, {
            dosya: dosya ? `${dosya.yol} (${dosya.mb} MB)` : undefined,
            surum_kodlari: kodlar.length ? kodlar : undefined,
            kanal,
            durum: durum.status,
            yuzde: durum.userFraction ? durum.userFraction * 100 : durum.status === "completed" ? 100 : undefined,
            notlar: notlar?.map((n) => n.language),
            incelemeye_gonder: girdi.incelemeye_gonder !== false,
          });
        }

        return duzenlemede(
          girdi.paket_adi,
          async (edit) => {
            if (dosya) {
              const veri = new Uint8Array(await readFile(dosya.yol));
              const yuklenen: any =
                dosya.uzanti === ".aab"
                  ? await yukle(`${edit}/bundles`, veri, "application/octet-stream")
                  : await yukle(`${edit}/apks`, veri, "application/vnd.android.package-archive");
              if (!yuklenen?.versionCode) throw new Error("Dosya yüklendi ama Google versionCode döndürmedi.");
              kodlar.push(String(yuklenen.versionCode));
            }
            const yeni: Surum = { versionCodes: kodlar, ...durum, releaseNotes: notlar };
            const surumler = kanalaEkle(await kanalOku(edit, kanal), yeni);
            await kanalYaz(edit, kanal, surumler);
            return { basarili: true, kanal, surum_kodlari: kodlar, kanaldaki_surumler: ozetle(surumler) };
          },
          girdi.incelemeye_gonder !== false,
        );
      },
    },

    {
      ad: "play__yayin_yonet",
      aciklama:
        "Bir kanaldaki yayını yönetir, tek onayla. islem:\n" +
        "- yuzde: kademeli yayının yüzdesini değiştir (100 = tamamla)\n" +
        "- durdur / devam: kademeli yayını durdur ya da sürdür\n" +
        "- tamamla: herkese aç\n" +
        "- tasi: sürümü hedef_kanal'a taşı (örn. internal → production), istersen yuzde ile kademeli\n" +
        "- notlar: yalnızca sürüm notlarını güncelle, yayına dokunma\n" +
        "Önizlemede kanalın önceki ve sonraki hali görünür.",
      girdiSemasi: {
        type: "object",
        properties: {
          paket_adi: paketAlani,
          kanal: KANAL_SEMASI,
          islem: { type: "string", enum: [...ISLEMLER] },
          yuzde: sayi("yuzde ve tasi için: 1-100."),
          hedef_kanal: metin("tasi için hedef kanal."),
          notlar: {
            type: "object",
            description: "notlar/tasi için dil → metin. notlar işleminde verilmeyen diller korunur.",
            additionalProperties: { type: "string" },
          },
          incelemeye_gonder: incelemeSemasi,
          onayla: onaySemasi,
        },
        required: ["paket_adi", "kanal", "islem"],
      },
      yazma: true,
      async calistir(girdi) {
        if (!ISLEMLER.includes(girdi.islem)) throw new Error(`islem şunlardan biri olmalı: ${ISLEMLER.join(", ")}`);
        if (girdi.islem === "tasi" && !girdi.hedef_kanal) throw new Error("tasi için hedef_kanal vermelisin.");
        const kanal = String(girdi.kanal);
        const hedefKanal = girdi.islem === "tasi" ? String(girdi.hedef_kanal) : undefined;

        const hesapla = async (edit: string) => {
          const kaynak = await kanalOku(edit, kanal);
          const hedef = hedefKanal ? await kanalOku(edit, hedefKanal) : [];
          return { kaynak, hedef, yeni: yeniKanallar(girdi, kaynak, hedef) };
        };

        if (girdi.onayla !== true) {
          const { kaynak, hedef, yeni } = await oturumda(girdi.paket_adi, (id) =>
            hesapla(`${taban(girdi.paket_adi)}/edits/${id}`),
          );
          return onayIste(`edits → ${hedefKanal ?? kanal}`, `${girdi.paket_adi}: ${girdi.islem}`, {
            [kanal]: yeni.kaynak ? { simdi: ozetle(kaynak), sonra: ozetle(yeni.kaynak) } : undefined,
            ...(hedefKanal && yeni.hedef ? { [hedefKanal]: { simdi: ozetle(hedef), sonra: ozetle(yeni.hedef) } } : {}),
          });
        }

        return duzenlemede(
          girdi.paket_adi,
          async (edit) => {
            const { yeni } = await hesapla(edit);
            if (yeni.kaynak) await kanalYaz(edit, kanal, yeni.kaynak);
            if (hedefKanal && yeni.hedef) await kanalYaz(edit, hedefKanal, yeni.hedef);
            return {
              basarili: true,
              [kanal]: yeni.kaynak ? ozetle(yeni.kaynak) : undefined,
              ...(hedefKanal && yeni.hedef ? { [hedefKanal]: ozetle(yeni.hedef) } : {}),
            };
          },
          girdi.incelemeye_gonder !== false,
        );
      },
    },

    {
      ad: "play__listeleme_guncelle",
      aciklama:
        "Mağaza sayfası metinlerini (başlık, kısa ve tam açıklama, video) okur veya " +
        "günceller. Bütün diller tek oturumda, tek onayla yazılır. listelemeler " +
        "vermezsen mevcut metinleri döndürür (dil verirsen o dilin tam metnini).",
      girdiSemasi: {
        type: "object",
        properties: {
          paket_adi: paketAlani,
          listelemeler: {
            type: "object",
            description:
              "Dil kodu → alanlar, örn. {\"tr-TR\": {\"baslik\": \"...\", \"kisa_aciklama\": \"...\"}}. " +
              "Verilmeyen alanlar korunur. Sınırlar: baslik 30, kisa_aciklama 80, tam_aciklama 4000 karakter.",
            additionalProperties: {
              type: "object",
              properties: {
                baslik: { type: "string" },
                kisa_aciklama: { type: "string" },
                tam_aciklama: { type: "string" },
                video: { type: "string" },
              },
            },
          },
          dil: metin("Okurken: yalnızca bu dilin tam metni."),
          incelemeye_gonder: incelemeSemasi,
          onayla: onaySemasi,
        },
        required: ["paket_adi"],
      },
      yazma: true,
      async calistir(girdi) {
        const listeOku = async (edit: string) => {
          const y: any = await cagir({ yontem: "GET", yol: `${edit}/listings` });
          return new Map<string, any>((y.listings ?? []).map((l: any) => [l.language, l]));
        };

        if (girdi.listelemeler === undefined) {
          const mevcut = await oturumda(girdi.paket_adi, (id) => listeOku(`${taban(girdi.paket_adi)}/edits/${id}`));
          if (girdi.dil) {
            const l = mevcut.get(girdi.dil);
            if (!l) throw new Error(`${girdi.dil} dilinde listeleme yok. Mevcut diller: ${[...mevcut.keys()].join(", ")}`);
            return { dil: l.language, baslik: l.title, kisa_aciklama: l.shortDescription, tam_aciklama: l.fullDescription, video: l.video };
          }
          // 30 dilin tam açıklaması 100 bin karakteri bulur; özet dönüyoruz.
          return {
            dil_sayisi: mevcut.size,
            listelemeler: [...mevcut.values()].map((l) => ({
              dil: l.language,
              baslik: l.title,
              kisa_aciklama: l.shortDescription,
              tam_aciklama_uzunlugu: l.fullDescription?.length ?? 0,
            })),
          };
        }

        const ham = girdi.listelemeler;
        if (!ham || typeof ham !== "object" || Array.isArray(ham)) throw new Error("listelemeler dil → alanlar nesnesi olmalı.");
        const SINIR = { baslik: 30, kisa_aciklama: 80, tam_aciklama: 4000 } as const;
        const yazilacak = Object.entries<any>(ham).map(([dil, a]) => {
          for (const [alan, ust] of Object.entries(SINIR)) {
            const uzunluk = a?.[alan]?.length ?? 0;
            if (uzunluk > ust) throw new Error(`${dil} ${alan} ${uzunluk} karakter; Play sınırı ${ust}.`);
          }
          const govde: Record<string, string> = { language: dil };
          if (a?.baslik !== undefined) govde.title = a.baslik;
          if (a?.kisa_aciklama !== undefined) govde.shortDescription = a.kisa_aciklama;
          if (a?.tam_aciklama !== undefined) govde.fullDescription = a.tam_aciklama;
          if (a?.video !== undefined) govde.video = a.video;
          return { dil, govde };
        });
        if (!yazilacak.length) throw new Error("En az bir dil vermelisin.");

        if (girdi.onayla !== true) {
          const mevcut = await oturumda(girdi.paket_adi, (id) => listeOku(`${taban(girdi.paket_adi)}/edits/${id}`));
          return onayIste("edits → listings", `${yazilacak.length} dilde mağaza metnini günceller.`, {
            diller: yazilacak.map(({ dil, govde }) => ({
              dil,
              yeni_dil: !mevcut.has(dil) || undefined,
              alanlar: Object.keys(govde).filter((k) => k !== "language"),
              baslik: govde.title,
              kisa_aciklama: govde.shortDescription,
            })),
          });
        }

        return duzenlemede(
          girdi.paket_adi,
          async (edit) => {
            const mevcut = await listeOku(edit);
            for (const { dil, govde } of yazilacak) {
              const yol = `${edit}/listings/${yolParcasi(dil, "dil")}`;
              // Yeni dil PATCH ile oluşmuyor; PUT tam kayıt ister.
              if (mevcut.has(dil)) await cagir({ yontem: "PATCH", yol, govde });
              else await cagir({ yontem: "PUT", yol, govde });
            }
            return { basarili: true, guncellenen_diller: yazilacak.map((y) => y.dil) };
          },
          girdi.incelemeye_gonder !== false,
        );
      },
    },

    {
      ad: "play__gorsel_yukle",
      aciklama:
        "Mağaza görsellerini yükler: ekran görüntüleri, ikon, öne çıkan görsel. " +
        "Dosyalar verdiğin sırayla yüklenir; once_temizle ile o türdeki eski " +
        "görseller önce silinir. Tek oturum, tek onay.",
      girdiSemasi: {
        type: "object",
        properties: {
          paket_adi: paketAlani,
          dil: metin("Listeleme dili, örn. tr-TR, en-US."),
          tur: { type: "string", enum: GORSEL_TURLERI },
          dosyalar: { type: "array", items: { type: "string" }, description: "PNG/JPEG dosya yolları (en fazla 8 ekran görüntüsü)." },
          once_temizle: { type: "boolean", description: "Bu türdeki mevcut görselleri önce sil (varsayılan false)." },
          incelemeye_gonder: incelemeSemasi,
          onayla: onaySemasi,
        },
        required: ["paket_adi", "dil", "tur", "dosyalar"],
      },
      yazma: true,
      async calistir(girdi) {
        if (!GORSEL_TURLERI.includes(girdi.tur)) throw new Error(`tur şunlardan biri olmalı: ${GORSEL_TURLERI.join(", ")}`);
        const liste: unknown[] = Array.isArray(girdi.dosyalar) ? girdi.dosyalar : [];
        const tekli = !girdi.tur.endsWith("Screenshots");
        if (!liste.length || liste.length > (tekli ? 1 : 8)) {
          throw new Error(tekli ? `${girdi.tur} için tek dosya ver.` : "1-8 ekran görüntüsü ver.");
        }
        const dosyalar = await Promise.all(liste.map((d) => dosyaBilgisi(d, [".png", ".jpg", ".jpeg"], 15)));

        if (girdi.onayla !== true) {
          return onayIste(`edits → listings/${girdi.dil}/${girdi.tur}`, `${dosyalar.length} görsel yükler.`, {
            dil: girdi.dil,
            tur: girdi.tur,
            once_temizle: girdi.once_temizle === true,
            dosyalar: dosyalar.map((d) => `${d.yol} (${d.mb} MB)`),
          });
        }

        return duzenlemede(
          girdi.paket_adi,
          async (edit) => {
            const yol = `${edit}/listings/${yolParcasi(girdi.dil, "dil")}/${girdi.tur}`;
            if (girdi.once_temizle === true) await cagir({ yontem: "DELETE", yol });
            for (const d of dosyalar) {
              await yukle(yol, new Uint8Array(await readFile(d.yol)), d.uzanti === ".png" ? "image/png" : "image/jpeg");
            }
            return { basarili: true, yuklenen: dosyalar.length, tur: girdi.tur, dil: girdi.dil };
          },
          girdi.incelemeye_gonder !== false,
        );
      },
    },

    {
      ad: "play__abonelik_fiyat_ayarla",
      aciklama:
        "Bir Play abonelik planının fiyatını bütün ülkelerde tek seferde ayarlar. " +
        "fiyat (USD) verilirse Google'ın kendi kuru ve yerel fiyat kalıplarıyla " +
        "~170 ülkenin fiyatı çıkarılır. ozel_fiyatlar ile ülkeye özel fiyat " +
        "(o ülkenin parasıyla) verilir; tek başına verilirse yalnızca o ülkeler " +
        "değişir. Mevcut aboneler eski fiyattan devam eder (Play'de geçiş ayrı onay ister).",
      girdiSemasi: {
        type: "object",
        properties: {
          paket_adi: paketAlani,
          urun_id: metin("play__abonelikler'den gelen urun_id."),
          plan_id: metin("Temel plan; abonelikte tek plan varsa boş bırakılabilir."),
          fiyat: metin("ABD doları cinsinden taban fiyat, örn. \"9.99\"."),
          ozel_fiyatlar: {
            type: "object",
            description:
              "Ülke kodu (2 harf) → o ülkenin parasıyla fiyat, örn. {\"TR\": \"349.99\"}. " +
              "play__fiyat_analizi'nin ozel_fiyatlar çıktısı olduğu gibi verilebilir.",
            additionalProperties: { type: "string" },
          },
          yeni_ulkelere_ac: {
            type: "boolean",
            description: "Planda olmayan ülkeleri de satışa aç (varsayılan true; yalnızca fiyat verilince).",
          },
          onayla: onaySemasi,
        },
        required: ["paket_adi", "urun_id"],
      },
      yazma: true,
      async calistir(girdi) {
        const tabanVar = girdi.fiyat !== undefined && girdi.fiyat !== "";
        if (!tabanVar && girdi.ozel_fiyatlar === undefined) throw new Error("fiyat ya da ozel_fiyatlar vermelisin.");
        const ozel = girdi.ozel_fiyatlar ?? {};
        if (typeof ozel !== "object" || Array.isArray(ozel)) throw new Error("ozel_fiyatlar ülke → fiyat nesnesi olmalı.");
        const ozelSayilar = Object.entries(ozel).map(([u, f]) => [u.toUpperCase(), fiyatSayisi(f, `${u} fiyatı`)] as const);

        const yol = `${taban(girdi.paket_adi)}/subscriptions/${yolParcasi(girdi.urun_id, "urun_id")}`;
        // Para birimlerini ve bölge sürümünü öğrenmek için çeviri her durumda gerekli.
        const [abonelik, cevrim] = await Promise.all([
          cagir({ yontem: "GET", yol }) as Promise<any>,
          bolgeFiyatlari(girdi.paket_adi, tabanVar ? fiyatSayisi(girdi.fiyat) : 1),
        ]);

        const planlar: any[] = abonelik.basePlans ?? [];
        const plan = girdi.plan_id ? planlar.find((p) => p.basePlanId === girdi.plan_id) : planlar.length === 1 ? planlar[0] : undefined;
        if (!plan) throw new Error(`Plan seç (plan_id): ${planlar.map((p) => p.basePlanId).join(", ") || "plan yok"}`);

        const ayarlar = new Map<string, any>((plan.regionalConfigs ?? []).map((r: any) => [r.regionCode, { ...r }]));
        let eklenen = 0;
        if (tabanVar) {
          for (const [kod, fiyat] of cevrim.bolgeler) {
            const mevcut = ayarlar.get(kod);
            if (mevcut) mevcut.price = fiyat;
            else if (girdi.yeni_ulkelere_ac !== false) {
              ayarlar.set(kod, { regionCode: kod, price: fiyat, newSubscriberAvailability: true });
              eklenen++;
            }
          }
        }
        const ozelNotlar: string[] = [];
        for (const [kod, deger] of ozelSayilar) {
          const kur = ayarlar.get(kod)?.price?.currencyCode ?? cevrim.bolgeler.get(kod)?.currencyCode;
          if (!kur) throw new Error(`${kod}: Play bu bölgeyi tanımıyor; 2 harfli ülke kodu ver (TR, US...).`);
          const mevcut = ayarlar.get(kod);
          if (mevcut) mevcut.price = para(kur, deger);
          else ayarlar.set(kod, { regionCode: kod, price: para(kur, deger), newSubscriberAvailability: true });
          ozelNotlar.push(`${kod}: ${paraBicimle(para(kur, deger))}`);
        }

        const yeniPlan = { ...plan, regionalConfigs: [...ayarlar.values()] };
        if (tabanVar && cevrim.digerleri) {
          yeniPlan.otherRegionsConfig = {
            usdPrice: cevrim.digerleri.usdPrice,
            eurPrice: cevrim.digerleri.eurPrice,
            newSubscriberAvailability: plan.otherRegionsConfig?.newSubscriberAvailability ?? true,
          };
        }

        if (girdi.onayla !== true) {
          return onayIste(
            `PATCH ${yol} (${plan.basePlanId})`,
            tabanVar
              ? `${plan.basePlanId} planının fiyatını USD ${girdi.fiyat} baz alınarak ${ayarlar.size} ülkede ayarlar.`
              : `${plan.basePlanId} planında yalnızca ${ozelNotlar.length} ülkenin fiyatını değiştirir.`,
            {
              ulke_sayisi: ayarlar.size,
              yeni_acilan_ulke: eklenen || undefined,
              ornek_fiyatlar: tabanVar
                ? ORNEK_BOLGELER.filter((k) => ayarlar.has(k)).map((k) => `${k}: ${paraBicimle(ayarlar.get(k).price)}`)
                : undefined,
              ozel_fiyatlar: ozelNotlar.length ? ozelNotlar : undefined,
              not: "Mevcut aboneler eski fiyattan devam eder; geçirmek Play Console'dan ayrı işlem.",
            },
          );
        }

        await cagir({
          yontem: "PATCH",
          yol,
          // updateMask=basePlans gövdedeki planların TAMAMINI yazar; diğer planları
          // gövdeden düşürmek onları silmek demek, o yüzden hepsini geri gönderiyoruz.
          sorgu: { updateMask: "basePlans", "regionsVersion.version": cevrim.surum ?? "2022/02" },
          govde: { ...abonelik, basePlans: planlar.map((p) => (p === plan ? yeniPlan : p)) },
        });
        return { basarili: true, plan: plan.basePlanId, ulke_sayisi: ayarlar.size, ozel_fiyatlar: ozelNotlar.length || undefined };
      },
    },

    {
      ad: "play__fiyat_analizi",
      aciklama:
        "Play için ülkelere özel fiyat önerir; hiçbir şey yazmaz. USD fiyatı Google'ın " +
        "kuruyla bütün ülkelere çevirir, ülkenin alım gücüne (Dünya Bankası) göre " +
        "yumuşatılmış indirim uygular ve mağazada doğal görünen fiyata yuvarlar. Fiyatı " +
        "öldürmemek için: hiçbir fiyat artmaz, en_dusuk_oran'ın altına inmez, %15'ten az " +
        "indirim gereken ülkelere dokunulmaz. Öneriyi kullanıcıya göster, onaylarsa " +
        "play__abonelik_fiyat_ayarla'ya fiyat + ozel_fiyatlar olarak ver.",
      girdiSemasi: {
        type: "object",
        properties: {
          paket_adi: paketAlani,
          fiyat: metin("ABD doları cinsinden taban fiyat, örn. \"9.99\"."),
          yansitma: sayi("Alım gücü farkının ne kadarı yansısın, 0-1 (varsayılan 0.4). 1 = agresif."),
          en_dusuk_oran: sayi("Hiçbir ülke eşit fiyatın bu oranının altına inmesin (varsayılan 0.5)."),
        },
        required: ["paket_adi", "fiyat"],
      },
      async calistir(girdi) {
        const usd = fiyatSayisi(girdi.fiyat);
        const yansitma = Math.min(1, Math.max(0, Number(girdi.yansitma ?? 0.4) || 0));
        const alt = Math.min(1, Math.max(0.1, Number(girdi.en_dusuk_oran ?? 0.5) || 0.5));
        const [cevrim, veri] = await Promise.all([bolgeFiyatlari(girdi.paket_adi, usd), alimGucuVerisi()]);
        const abd = fiyatSeviyesi(veri, "US") ?? 1;

        const oneriler: { kod: string; satir: string; fiyat: string; indirim: number }[] = [];
        for (const [kod, p] of cevrim.bolgeler) {
          const seviye = fiyatSeviyesi(veri, kod, p.currencyCode);
          if (!seviye || kod === "US") continue;
          const goreli = seviye / abd;
          const carpan = Math.min(1, Math.max(alt, goreli ** yansitma));
          // %15'ten az indirim gürültü: geliri düşürür, satışı pek artırmaz.
          if (carpan > 0.85) continue;
          const esit = paraSayisi(p);
          const yeni = guzelFiyat(esit * carpan, p.currencyCode);
          const indirim = Math.round((1 - yeni / esit) * 100);
          if (indirim < 10) continue;
          const yeniMetin = yeni.toFixed(ondalik(p.currencyCode));
          oneriler.push({
            kod,
            fiyat: yeniMetin,
            indirim,
            satir: `${kod}: ${paraBicimle(p)} → ${yeniMetin} ${p.currencyCode} (-%${indirim}, alım gücü ${goreli.toFixed(2)})`,
          });
        }
        oneriler.sort((a, b) => b.indirim - a.indirim);

        return {
          taban: `USD ${usd}`,
          esit_kalan_ulke: cevrim.bolgeler.size - oneriler.length,
          indirimli_ulke: oneriler.length,
          oneriler: oneriler.map((o) => o.satir),
          ozel_fiyatlar: Object.fromEntries(oneriler.map((o) => [o.kod, o.fiyat])),
          ayarlar: { yansitma, en_dusuk_oran: alt },
          kaynak: "Kur: Google convertRegionPrices. Alım gücü: Dünya Bankası, hane tüketimi PPP / resmi kur.",
          not:
            "Hiçbir şey yazılmadı. Kullanıcıya önerileri göster; onaylarsa " +
            "play__abonelik_fiyat_ayarla'ya fiyat ve bu ozel_fiyatlar ile çağır.",
        };
      },
    },
  ];
}
