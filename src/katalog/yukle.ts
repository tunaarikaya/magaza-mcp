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
 * adında geçiyorsa yüksek, özet/yolda geçiyorsa düşük puan. Tüm kelimeleri
 * içermeyen sonuçlar elenir, böylece "abonelik fiyat" araması sadece
 * fiyatla ilgili abonelik uçlarını getirir.
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

  const sonuclar: AramaSonucu[] = [];

  for (const magaza of magazalar) {
    for (const op of katalog(magaza).operasyonlar) {
      const ad = op.ad.toLowerCase();
      let puan = 0;
      let eksik = false;

      for (const kelime of kelimeler) {
        if (ad.includes(kelime)) {
          puan += 10;
        } else if (op.arama.includes(kelime)) {
          puan += 3;
        } else {
          eksik = true;
          break;
        }
      }

      if (eksik) continue;

      // Kısa yollar genelde daha genel ve daha çok işe yarar.
      puan += Math.max(0, 5 - op.yol.split("/").length);
      sonuclar.push({ ...op, magaza, puan });
    }
  }

  return sonuclar
    .sort((a, b) => b.puan - a.puan)
    .slice(0, secenek.limit ?? 15);
}

/* ------------------------------------------------------------------ */
/* Gövde şeması — sadece istendiğinde spec'ten okunur                   */
/* ------------------------------------------------------------------ */

let _appleSpec: Record<string, any> | null = null;

/**
 * Bir operasyonun istek gövdesi şemasını döndürür.
 *
 * Apple spec'i 7 MB; açılışta okumak sunucuyu yavaşlatır, bu yüzden ilk
 * ihtiyaç anına bırakılıyor.
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
    const ad = op.govdeRef.split("/").pop()!;
    return _appleSpec!.components?.schemas?.[ad] ?? null;
  }

  // Play discovery'de şemalar `schemas` altında düz duruyor.
  const dosya = op.api === "reporting" ? "play-reporting.json" : "play.json";
  const spec = JSON.parse(readFileSync(join(kok, "spec", dosya), "utf8"));
  return spec.schemas?.[op.govdeRef] ?? null;
}
