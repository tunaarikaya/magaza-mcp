/**
 * Operasyon kataloğu.
 *
 * `scripts/uret-katalog.mjs` tarafından Apple ve Google'ın resmî
 * spesifikasyonlarından üretilen katalogları okur ve arama sağlar.
 *
 * Katalogda her operasyonun arama ve çağırma için gereken bilgisi var;
 * hacimli gövde şemaları spec dosyalarında kalır, ancak istendiğinde okunur.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const buDizin = dirname(fileURLToPath(import.meta.url));

/**
 * Paketin kökünü bulur — spec/ dizinini barındıran dizin.
 *
 * Kaynaktan mı (src/katalog) yoksa derlenmiş halden mi (dist/src/katalog)
 * çalıştığımıza göre aradaki basamak sayısı değişiyor; sabit sayıda ".."
 * yazmak yerine spec/ görünene kadar yukarı çıkıyoruz.
 */
function kokBul(): string {
  let dizin = buDizin;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dizin, "spec"))) return dizin;
    const ust = dirname(dizin);
    if (ust === dizin) break;
    dizin = ust;
  }
  return join(buDizin, "..", "..", "..");
}

const kok = kokBul();

export type Parametre = {
  ad: string;
  konum: "path" | "query" | string;
  gerekli: boolean;
  tip: string;
  /** Tekrarlanabilir mi (?id=a&id=b)? Yalnızca Play tarafında işaretli. */
  cok?: boolean;
  aciklama?: string;
};

export type Operasyon = {
  ad: string;
  yontem: string;
  yol: string;
  ozet: string;
  parametreler: Parametre[];
  govdeRef?: string;
  arama: string;
  /** Apple spec'inde `deprecated: true` işaretli mi? */
  eskimis?: boolean;
  /** Yalnızca Play tarafında: hangi API'ye ait. */
  api?: "publisher" | "reporting";
};

export type Katalog = {
  magaza: "appstore" | "play";
  surum: string;
  operasyonlar: Operasyon[];
};

function katalogOku(dosya: string): Katalog {
  return JSON.parse(readFileSync(join(buDizin, dosya), "utf8"));
}

let _appstore: Katalog | null = null;
let _play: Katalog | null = null;

export function appstoreKatalog(): Katalog {
  return (_appstore ??= katalogOku("appstore.json"));
}

export function playKatalog(): Katalog {
  return (_play ??= katalogOku("play.json"));
}

export function katalog(magaza: "appstore" | "play"): Katalog {
  return magaza === "appstore" ? appstoreKatalog() : playKatalog();
}

/** Bir operasyonu adıyla bulur. */
export function operasyonBul(
  magaza: "appstore" | "play",
  ad: string,
): Operasyon | undefined {
  return katalog(magaza).operasyonlar.find((o) => o.ad === ad);
}

export type AramaSonucu = Operasyon & {
  magaza: "appstore" | "play";
  puan: number;
};

/**
 * Katalogda arama yapar.
 *
 * Basit ama işe yarayan bir puanlama: sorgudaki her kelime için operasyon
 * adında geçiyorsa yüksek, özet/yolda geçiyorsa düşük puan.
 *
 * Önce tüm kelimeleri içerenler aranır. Katı "VE" tek başına bırakıldığında
 * kullanıcı API'nin kelimesini bilmediği anda sıfır sonuç dönüyor; bu yüzden
 * hiç sonuç çıkmazsa aynı puanlama "en çok kelimeyi tutturan kazanır"
 * biçiminde gevşetilerek tekrarlanır.
 */
export function ara(
  sorgu: string,
  secenek: { magaza?: "appstore" | "play"; limit?: number } = {},
): AramaSonucu[] {
  const kelimeler = sorgu
    .toLowerCase()
    .split(/\s+/)
    .map((k) => k.trim())
    .filter(Boolean);

  if (kelimeler.length === 0) return [];

  const magazalar: ("appstore" | "play")[] = secenek.magaza
    ? [secenek.magaza]
    : ["appstore", "play"];

  const tara = (hepsiGerekli: boolean): AramaSonucu[] => {
    const sonuclar: AramaSonucu[] = [];

    for (const magaza of magazalar) {
      for (const op of katalog(magaza).operasyonlar) {
        const ad = op.ad.toLowerCase();
        let puan = 0;
        let tutan = 0;

        for (const kelime of kelimeler) {
          if (ad.includes(kelime)) {
            puan += 10;
            tutan++;
          } else if (op.arama.includes(kelime)) {
            puan += 3;
            tutan++;
          } else if (hepsiGerekli) {
            tutan = -1;
            break;
          }
        }

        if (tutan <= 0) continue;

        // Gevşek turda önce kaç kelime tuttuğuna bakılır.
        puan += tutan * 20;

        // Kısa yollar genelde daha genel ve daha çok işe yarar.
        puan += Math.max(0, 5 - op.yol.split("/").length);

        // Model çoğu zaman önce okumak ister; listeleme/okuma uçları öne,
        // silme uçları arkaya. Yoksa "subscription price" aramasında ikinci
        // sırada `subscriptionPrices_deleteInstance` çıkıyor.
        if (op.yontem === "GET") puan += 4;
        else if (op.yontem === "DELETE") puan -= 6;

        // Eskimiş uçlar katalogda duruyor ama yerine geçen varken önerilmesin.
        if (op.eskimis) puan -= 30;

        // Eşitlik bozucu: kısa ad = daha genel kaynak. "in app purchase"
        // aramasında `inAppPurchasesV2` yerine
        // `inAppPurchaseAppStoreReviewScreenshots` başa geçmesin diye.
        puan -= op.ad.length / 20;

        sonuclar.push({ ...op, magaza, puan });
      }
    }

    return sonuclar;
  };

  const sonuclar = tara(true);
  const nihai = sonuclar.length ? sonuclar : tara(false);

  return nihai.sort((a, b) => b.puan - a.puan).slice(0, secenek.limit ?? 15);
}

/* ------------------------------------------------------------------ */
/* Gövde şeması — sadece istendiğinde spec'ten okunur                   */
/* ------------------------------------------------------------------ */

let _appleSpec: Record<string, any> | null = null;
/** Play discovery dökümanları da önbelleğe alınır; bkz. `specOku`. */
const _playSpec = new Map<string, Record<string, any>>();

function specOku(dosya: string): Record<string, any> {
  let spec = _playSpec.get(dosya);
  if (!spec) {
    spec = JSON.parse(readFileSync(join(kok, "spec", dosya), "utf8"));
    _playSpec.set(dosya, spec!);
  }
  return spec!;
}

/** İç içe $ref çözerken bir şemanın ne kadar derine inileceği. */
const REF_DERINLIK = 4;

/**
 * Şemadaki `$ref`leri yerine koyar.
 *
 * Apple'ın gövde şemaları tek katman değil: `AppUpdateRequest` içinde
 * `data`, onun içinde `attributes`/`relationships` hep `$ref` ile gelir.
 * Sadece en dıştaki adı çözüp bırakırsak model gövdenin alanlarını hiç
 * göremez ve POST/PATCH gövdesini tahminle kurar. Döngüsel referanslar
 * (kendini içeren şemalar) olduğu için hem derinlik sınırı hem de aynı dal
 * üzerinde tekrar eden ref koruması var.
 */
function refCoz(
  dugum: unknown,
  semalar: Record<string, any>,
  derinlik: number,
  gorulen: ReadonlySet<string>,
): unknown {
  if (derinlik <= 0 || dugum === null || typeof dugum !== "object") {
    return dugum;
  }

  if (Array.isArray(dugum)) {
    return dugum.map((x) => refCoz(x, semalar, derinlik, gorulen));
  }

  const nesne = dugum as Record<string, unknown>;

  if (typeof nesne.$ref === "string") {
    const ad = nesne.$ref.split("/").pop()!;
    if (gorulen.has(ad)) return { $ref: ad, not: "döngüsel referans" };
    const hedef = semalar[ad];
    if (!hedef) return nesne;
    return refCoz(hedef, semalar, derinlik - 1, new Set(gorulen).add(ad));
  }

  const sonuc: Record<string, unknown> = {};
  for (const [anahtar, deger] of Object.entries(nesne)) {
    sonuc[anahtar] = refCoz(deger, semalar, derinlik, gorulen);
  }
  return sonuc;
}

/**
 * Bir operasyonun istek gövdesi şemasını döndürür.
 *
 * Apple spec'i 7 MB; açılışta okumak sunucuyu yavaşlatır, bu yüzden ilk
 * ihtiyaç anına bırakılıyor. Play dökümanları da (640 KB + 200 KB) aynı
 * şekilde bir kez okunup saklanıyor: eskiden her çağrıda yeniden okunup
 * ayrıştırılıyordu.
 */
export function govdeSemasi(
  magaza: "appstore" | "play",
  op: Operasyon,
): unknown | null {
  if (!op.govdeRef) return null;

  if (magaza === "appstore") {
    _appleSpec ??= JSON.parse(
      readFileSync(join(kok, "spec", "appstore-openapi.json"), "utf8"),
    );
    const semalar = _appleSpec!.components?.schemas ?? {};
    const ad = op.govdeRef.split("/").pop()!;
    const sema = semalar[ad];
    if (!sema) return null;
    return refCoz(sema, semalar, REF_DERINLIK, new Set([ad]));
  }

  // Play discovery'de şemalar `schemas` altında düz duruyor.
  const spec = specOku(
    op.api === "reporting" ? "play-reporting.json" : "play.json",
  );
  const semalar = spec.schemas ?? {};
  const sema = semalar[op.govdeRef];
  if (!sema) return null;
  return refCoz(sema, semalar, REF_DERINLIK, new Set([op.govdeRef]));
}
