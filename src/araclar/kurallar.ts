/**
 * Apple App Review Guidelines — canlı okuma + değişiklik takibi.
 *
 * Bu sayfa App Store Connect API'sinin parçası değil, Apple'ın herkese açık
 * kural metni (developer.apple.com/app-store/review/guidelines). Burada
 * amaç "kodu kurallara göre kontrol eden statik bir motor" YAZMAK değil —
 * öyle bir motor yazılır yazılmaz Apple kuralı değiştirdiğinde o da bayatlar,
 * tam da kullanıcının korktuğu şey. Onun yerine her çağrıda sayfayı taze
 * çekiyoruz; modelin kendisi (Claude) güncel metne karşı kodu okuyup
 * değerlendiriyor. Ek olarak son kontrolden beri hangi kural id'lerinin
 * metni değiştiğini yerel bir önbellekle karşılaştırıp söylüyoruz — "Apple
 * yarın kuralı değiştirip zınk kapatıyor" korkusuna karşı asıl işe yarayan
 * kısım bu.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const SAYFA_URL = "https://developer.apple.com/app-store/review/guidelines/";
const ONBELLEK_YOLU = join(homedir(), ".config", "magaza-mcp", "kurallar-onbellek.json");

/** Apple'ın sayfasında en az bu kadar numaralı kural olmalı; azsa HTML yapısı değişmiş, sessizce yarım veri döndürme. */
const BEKLENEN_MIN_KURAL = 125;

export type Kural = { id: string; baslik?: string; metin: string };

const VARLIK_TABLOSU: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Apple'ın sayfasında geçen HTML varlıklarını çözer; genel bir HTML decoder değil, sadece bu sayfada görülenler. */
function varlikCoz(ham: string): string {
  return ham
    .replace(/&#(\d+);/g, (_, kod) => String.fromCodePoint(Number(kod)))
    .replace(/&([a-zA-Z]+);/g, (esles, ad) => VARLIK_TABLOSU[ad] ?? esles);
}

function etiketTemizle(ham: string): string {
  return varlikCoz(ham.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

/**
 * `baslangic`'ten itibaren, iç içe `<li>` derinliğini sayarak bu maddenin
 * KENDİ `</li>` kapanışını bulur ve arasındaki HTML'i döner.
 *
 * Basit bir `.*?<\/li>` (non-greedy) kullanılsaydı madde kendi içinde başka
 * bir `<ul><li>` taşıyorsa (örn. 4.2.7, 5.1.1 gibi (i)/(ii) alt noktaları
 * olan kurallar) ilk iç `</li>`'de durup metnin çoğunu keserdi.
 */
function govdeAyikla(html: string, baslangic: number, siniir = 6000): string {
  let derinlik = 0;
  let i = baslangic;
  while (i < html.length && i - baslangic < siniir) {
    const aLi = html.indexOf("<li", i);
    const kLi = html.indexOf("</li>", i);
    if (kLi === -1) break;
    if (aLi !== -1 && aLi < kLi) {
      derinlik++;
      i = aLi + 3;
    } else if (derinlik === 0) {
      return html.slice(baslangic, kLi);
    } else {
      derinlik--;
      i = kLi + 5;
    }
  }
  return html.slice(baslangic, Math.min(html.length, baslangic + siniir));
}

/**
 * HTML'i { id -> kural } eşlemesine çevirir.
 *
 * Apple'ın sayfasında numaralı bir kuralın id'si iki yerde olabilir:
 * doğrudan `<li id="1.1.1">` üzerinde (çoğu alt madde), veya madde `<li
 * id="bir-slug">` gibi kelime bazlı bir id taşıyorken numara içeride
 * `<span id="5.1.1"></span>` olarak (başlığı ağır, (i)/(ii) alt listesi olan
 * maddeler, örn. 5.1.1 Data Collection). İkisi de aynı yerde yakalanıyor;
 * numara ile başlık arasına bazen bir ipucu ikonu (`<span
 * class="custom-tooltip-icon">`) girdiği için başlık `</strong>`'a kadar
 * (ikon dahil) alınıp sonra etiketlerden temizleniyor. Apple sayfayı yeniden
 * tasarlarsa bu regex kırılır — BEKLENEN_MIN_KURAL eşiği bunu sessiz veri
 * kaybı yerine açık hataya çevirir.
 */
export function htmlAyristir(html: string): Map<string, Kural> {
  const kurallar = new Map<string, Kural>();

  for (const m of html.matchAll(/<li[^>]*\bid="(\d[\d.]*)"[^>]*>|<span id="(\d[\d.]*)"><\/span>/g)) {
    const id = m[1] ?? m[2];
    const ankorSonu = m.index! + m[0].length;

    if (!id.includes(".")) {
      // Üst bölüm (1-5): kendi gövdesi tüm alt başlıkları içeriyor, sadece ad yeter.
      if (kurallar.has(id)) continue;
      const parca = html.slice(ankorSonu, ankorSonu + 150).split(/<\/h3>|<p/)[0];
      const baslik = etiketTemizle(parca).replace(/^[\d.]+\.?\s*/, "");
      if (baslik) kurallar.set(id, { id, baslik, metin: baslik });
      continue;
    }

    const strongKapanis = html.indexOf("</strong>", ankorSonu);
    const basliklaBirlikte = strongKapanis !== -1 && strongKapanis - ankorSonu < 400;
    const baslikHam = basliklaBirlikte ? html.slice(ankorSonu, strongKapanis) : "";
    const govdeBaslangic = basliklaBirlikte ? strongKapanis + "</strong>".length : ankorSonu;

    const baslik = etiketTemizle(baslikHam).replace(/^[\d.]+\.?\s*/, "");
    const govde = etiketTemizle(govdeAyikla(html, govdeBaslangic));
    const metin = govde || baslik;
    if (!metin) continue;

    const mevcut = kurallar.get(id);
    if (!mevcut || metin.length > mevcut.metin.length) {
      kurallar.set(id, { id, baslik: baslik || mevcut?.baslik, metin });
    }
  }

  return kurallar;
}

/** Bir kuralın üst başlıklarını id önekinden bulur: "1.1.1" için ["1", "1.1"]. */
function ustBasliklar(id: string, kurallar: Map<string, Kural>): string[] {
  const parcalar = id.split(".");
  const yol: string[] = [];
  for (let i = 1; i < parcalar.length; i++) {
    const ustId = parcalar.slice(0, i).join(".");
    const ust = kurallar.get(ustId);
    if (ust?.baslik) yol.push(`${ustId} ${ust.baslik}`);
  }
  return yol;
}

type Onbellek = { cekilme_tarihi: string; sayfa_guncelleme?: string; kurallar: Record<string, string> };

function onbellekOku(): Onbellek | null {
  try {
    return JSON.parse(readFileSync(ONBELLEK_YOLU, "utf8"));
  } catch {
    return null;
  }
}

function onbellekYaz(onbellek: Onbellek): void {
  try {
    mkdirSync(dirname(ONBELLEK_YOLU), { recursive: true });
    writeFileSync(ONBELLEK_YOLU, JSON.stringify(onbellek, null, 2));
  } catch {
    // Önbellek yazılamazsa (salt-okunur dosya sistemi vb.) sessizce geç —
    // bir sonraki çağrı yine taze veri çeker, sadece diff kaybolur.
  }
}

function ozet(metin: string): string {
  return createHash("sha256").update(metin).digest("hex").slice(0, 16);
}

export type KurallarSonucu = {
  son_kontrol: string;
  sayfa_son_guncelleme: string | null;
  toplam_kural: number;
  ilk_kontrol: boolean;
  degisen_kurallar: { id: string; baslik?: string; onceki_kontrolden_beri: "yeni" | "degisti" }[];
  kaldirilan_kurallar: string[];
  eslesenler?: { id: string; baslik?: string; ust_basliklar: string[]; metin: string }[];
};

/**
 * Sayfayı taze çeker, önbellekle karşılaştırır, isterse arama yapar.
 *
 * sorgu verilirse (id öneki veya anahtar kelime) eşleşen kuralların GÜNCEL
 * metnini de döndürür — model kodu buna karşı değerlendirsin diye.
 */
export async function kurallariGetir(sorgu?: string): Promise<KurallarSonucu> {
  const yanit = await fetch(SAYFA_URL, { signal: AbortSignal.timeout(15_000) });
  if (!yanit.ok) {
    throw new Error(`Apple'ın kurallar sayfası ${yanit.status} döndü. Bir süre sonra tekrar dene.`);
  }
  const html = await yanit.text();

  const kurallar = htmlAyristir(html);
  if (kurallar.size < BEKLENEN_MIN_KURAL) {
    throw new Error(
      `Sayfadan sadece ${kurallar.size} kural ayrıştırılabildi (en az ${BEKLENEN_MIN_KURAL} bekleniyordu). ` +
        "Apple'ın sayfa yapısı değişmiş olabilir; magaza-mcp'nin güncellenmesi gerekebilir.",
    );
  }

  const guncellemeTarihi = html.match(/Last Updated:[^>]*>([^<]+)</)?.[1]?.trim() ?? null;

  const onceki = onbellekOku();
  const degisen: KurallarSonucu["degisen_kurallar"] = [];
  const kaldirilan: string[] = [];

  if (onceki) {
    for (const [id, kural] of kurallar) {
      const eskiOzet = onceki.kurallar[id];
      const yeniOzet = ozet(kural.metin);
      if (eskiOzet === undefined) degisen.push({ id, baslik: kural.baslik, onceki_kontrolden_beri: "yeni" });
      else if (eskiOzet !== yeniOzet) degisen.push({ id, baslik: kural.baslik, onceki_kontrolden_beri: "degisti" });
    }
    for (const id of Object.keys(onceki.kurallar)) {
      if (!kurallar.has(id)) kaldirilan.push(id);
    }
  }

  const yeniOnbellek: Onbellek = {
    cekilme_tarihi: new Date().toISOString(),
    sayfa_guncelleme: guncellemeTarihi ?? undefined,
    kurallar: Object.fromEntries([...kurallar].map(([id, k]) => [id, ozet(k.metin)])),
  };
  onbellekYaz(yeniOnbellek);

  const sonuc: KurallarSonucu = {
    son_kontrol: yeniOnbellek.cekilme_tarihi,
    sayfa_son_guncelleme: guncellemeTarihi,
    toplam_kural: kurallar.size,
    ilk_kontrol: !onceki,
    degisen_kurallar: degisen,
    kaldirilan_kurallar: kaldirilan,
  };

  const sorguTemiz = sorgu?.trim().toLowerCase();
  if (sorguTemiz) {
    const eslesenler = [...kurallar.values()]
      .filter(
        (k) =>
          k.id === sorguTemiz ||
          k.id.startsWith(`${sorguTemiz}.`) ||
          k.baslik?.toLowerCase().includes(sorguTemiz) ||
          k.metin.toLowerCase().includes(sorguTemiz),
      )
      .slice(0, 40)
      .map((k) => ({ id: k.id, baslik: k.baslik, ust_basliklar: ustBasliklar(k.id, kurallar), metin: k.metin }));
    sonuc.eslesenler = eslesenler;
  }

  return sonuc;
}
