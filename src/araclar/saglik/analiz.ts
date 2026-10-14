import { klonKurallari } from "./kurallar/klon.js";
import { metadataKurallari } from "./kurallar/metadata.js";
import { yorumParaKurallari } from "./kurallar/yorum-para.js";
import { incelemeHesapKurallari } from "./kurallar/inceleme-hesap.js";
import { KURALLAR, type Bolum, type Bulgu, type Ciddiyet, type KuralSeti, type Veri } from "./tip.js";

const SETLER: Record<Bolum, KuralSeti> = {
  klon: klonKurallari,
  metadata: metadataKurallari,
  yorum_para: yorumParaKurallari,
  inceleme_hesap: incelemeHesapKurallari,
};

export const AGIRLIK: Record<Ciddiyet, number> = { kritik: 25, yuksek: 10, orta: 4, dusuk: 1 };
const SIRA: Record<Ciddiyet, number> = { kritik: 0, yuksek: 1, orta: 2, dusuk: 3 };

/** Seçili bölümlerin kurallarını koşar; bir kural seti patlarsa diğerleri yine döner. */
export function analizEt(veri: Veri, bolumler: Bolum[]): { bulgular: Bulgu[]; hatalar: Record<string, string> } {
  const bulgular: Bulgu[] = [];
  const hatalar: Record<string, string> = {};
  for (const b of bolumler) {
    try {
      bulgular.push(...SETLER[b](veri));
    } catch (e) {
      hatalar[`kural:${b}`] = (e as Error).message;
    }
  }
  bulgular.sort((a, b) => SIRA[a.ciddiyet] - SIRA[b.ciddiyet]);
  return { bulgular, hatalar };
}

/**
 * Her bulgu bağımsız bir risk olasılığı (ağırlık/100) sayılır, birleşimi alınır:
 * çok sayıda düşük bulgu puanı 100'e dayatmaz, tek kritik bulgu yine öne çıkar.
 */
// sınır: ağırlıklar elle seçildi; daha çok gerçek hesapla kalibre edilmeli
export function puanla(bulgular: Bulgu[]): number {
  const temiz = bulgular.reduce((p, b) => p * (1 - AGIRLIK[b.ciddiyet] / 100), 1);
  return Math.round(100 * (1 - temiz));
}

export function bolumOf(b: Bulgu): Bolum {
  return KURALLAR[b.kural].bolum;
}
