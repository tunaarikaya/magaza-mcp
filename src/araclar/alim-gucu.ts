/**
 * Ülkelerin fiyat seviyesi — bölgesel fiyat önerileri için.
 *
 * App Store ve Play analiz araçları ortak kullanır.
 */

export type Gosterge = Map<string, { deger: number; yil: string }>;
let _alimGucu: Promise<{ ppp: Gosterge; kur: Gosterge }> | undefined;

/**
 * Dünya Bankası'ndan ülkelerin fiyat seviyesi verisini çeker.
 *
 * Hane tüketimi PPP çevrim katsayısı / resmi kur: ABD = 1, Türkiye ≈ 0.45,
 * Hindistan ≈ 0.23. Anahtarsız, herkese açık veri; bizden hiçbir şey gitmez.
 */
export function alimGucuVerisi(): Promise<{ ppp: Gosterge; kur: Gosterge }> {
  const getir = async (gosterge: string): Promise<Gosterge> => {
    const yanit = await fetch(
      `https://api.worldbank.org/v2/country/all/indicator/${gosterge}?format=json&mrnev=1&per_page=500`,
      { signal: AbortSignal.timeout(10_000) },
    );
    const [, veri] = (await yanit.json()) as [unknown, any[]];
    if (!Array.isArray(veri)) throw new Error(`Dünya Bankası ${gosterge} verisi gelmedi.`);
    return new Map(
      veri
        .filter((x) => x?.value != null && x?.countryiso3code)
        // Apple ülkeleri 3 harfle (TUR), Play 2 harfle (TR) yazıyor; ikisini de anahtar yapıyoruz.
        .flatMap((x) => {
          const kayit = { deger: Number(x.value), yil: String(x.date) };
          return [[x.countryiso3code as string, kayit], [x.country?.id as string, kayit]] as const;
        })
        .filter(([u]) => !!u),
    );
  };
  _alimGucu ??= Promise.all([getir("PA.NUS.PRVT.PP"), getir("PA.NUS.FCRF")])
    .then(([ppp, kur]) => ({ ppp, kur }))
    .catch((hata) => {
      _alimGucu = undefined;
      throw new Error(`Alım gücü verisi alınamadı (api.worldbank.org): ${(hata as Error).message}`);
    });
  return _alimGucu;
}

/**
 * Bir ülkenin fiyat seviyesi (ABD = 1).
 *
 * Mağaza avroyla satıyorsa avro kuru kullanılır: avroya yeni geçen ülkelerde
 * (Bulgaristan 2026) PPP avroya çevrilmiş ama kur serisi eski parada kalmış,
 * oran yarıya düşüyordu. İki seri farklı yıldansa (Arjantin'de PPP 2021, kur
 * 2025) oran anlamsız; o ülke atlanır.
 */
export function fiyatSeviyesi(v: { ppp: Gosterge; kur: Gosterge }, ulke: string, para?: string) {
  const p = v.ppp.get(ulke);
  const k = para === "EUR" ? v.kur.get("DEU") : v.kur.get(ulke);
  if (!p || !k || k.yil !== p.yil || !(k.deger > 0)) return undefined;
  return p.deger / k.deger;
}
