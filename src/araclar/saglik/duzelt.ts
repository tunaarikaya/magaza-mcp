/**
 * appstore__hesap_duzelt: bulgu id'lerini güncel veriyle yeniden üretir,
 * önizler, onayla=true ile uygular. Eski taramaya güvenmez — arada
 * uygulama değişmiş olabilir.
 */
import { cagir, type Istek } from "../../istemci/apple.js";
import { kimlik, onayIste } from "../appstore.js";
import { analizEt } from "./analiz.js";
import { hesapVerisiTopla } from "./topla.js";
import { KURALLAR, type Bolum, type KuralId } from "./tip.js";

const EN_COK = 50;
const YER_TUTUCU = "<senin değerin>";

type Cozulen = { id: string; kural: KuralId; uygulamaId?: string; ek?: string };

export function bulguIdCoz(id: string): Omit<Cozulen, "id"> {
  const [kural, uygulama, ...ek] = String(id ?? "").trim().split(":");
  if (!kural || !uygulama) {
    throw new Error(
      `Geçersiz bulgu id'si: "${id}". Biçim kural:uygulamaId[:ek] — ` +
        "appstore__hesap_sagligi'nın döndürdüğü id'yi olduğu gibi ver.",
    );
  }
  if (!Object.hasOwn(KURALLAR, kural)) throw new Error(`Bilinmeyen kural: "${kural}" (${id}).`);
  return {
    kural: kural as KuralId,
    uygulamaId: uygulama === "hesap" ? undefined : kimlik(uygulama, "uygulama id"),
    ek: ek.length ? ek.join(":") : undefined,
  };
}

export function girdiDogrula(girdi: Record<string, any>): { cozulen: Cozulen[]; degerler: Record<string, string> } {
  const ham = girdi.bulgular;
  if (!Array.isArray(ham) || ham.length === 0) {
    throw new Error("bulgular boş olamaz: appstore__hesap_sagligi'nın döndürdüğü bulgu id'lerini ver.");
  }
  if (ham.length > EN_COK) throw new Error(`Tek seferde en çok ${EN_COK} bulgu düzeltilebilir (${ham.length} verildi).`);
  if (ham.some((x) => typeof x !== "string")) throw new Error("bulgular yalnızca metin id'lerden oluşmalı.");

  const degerler = girdi.degerler ?? {};
  if (
    typeof degerler !== "object" ||
    Array.isArray(degerler) ||
    Object.values(degerler).some((v) => typeof v !== "string")
  ) {
    throw new Error('degerler { "bulgu_id": "değer" } biçiminde olmalı.');
  }

  const idler = [...new Set((ham as string[]).map((s) => s.trim()))];
  return { cozulen: idler.map((id) => ({ id, ...bulguIdCoz(id) })), degerler };
}

export function kapsam(cozulen: Cozulen[]): { uygulamaIdleri?: string[]; bolumler: Bolum[] } {
  const bolumler = [...new Set(cozulen.map((c) => KURALLAR[c.kural].bolum as Bolum))];
  // Klon bulguları uygulamalar arası karşılaştırmadan, hesap bulguları tüm hesaptan çıkar; daraltmak onları yok eder.
  const tumHesap = cozulen.some((c) => !c.uygulamaId || KURALLAR[c.kural].bolum === "klon");
  return {
    bolumler,
    uygulamaIdleri: tumHesap ? undefined : [...new Set(cozulen.map((c) => c.uygulamaId!))],
  };
}

export async function hesapDuzelt(girdi: Record<string, any>): Promise<unknown> {
  const { cozulen, degerler } = girdiDogrula(girdi);
  const k = kapsam(cozulen);
  const veri = await hesapVerisiTopla(k);
  const { bulgular, hatalar } = analizEt(veri, k.bolumler);
  const toplamaHatalari = { ...veri.hatalar, ...hatalar };
  const eksikVeri = Object.keys(toplamaHatalari).length > 0;
  const harita = new Map(bulgular.map((b) => [b.id, b]));

  const uygulanacak: { id: string; baslik: string; degisim: unknown[]; istekler: Istek[] }[] = [];
  const atlanan: Record<string, unknown>[] = [];

  for (const { id } of cozulen) {
    const b = harita.get(id);
    if (!b) {
      atlanan.push({
        id,
        durum: eksikVeri
          ? "Bu sorun artık görünmüyor — ama bazı veriler okunamadı, bkz. toplama_hatalari."
          : "Bu sorun artık görünmüyor (düzelmiş olabilir).",
      });
      continue;
    }
    const d = b.duzeltme;
    if (!d) {
      atlanan.push({ id, baslik: b.baslik, durum: "Otomatik düzeltilemez — elle yapılmalı.", adimlar: b.adimlar, yapma: b.yapma });
      continue;
    }
    if (d.engel) {
      atlanan.push({ id, baslik: b.baslik, durum: d.engel, adimlar: b.adimlar, yapma: b.yapma });
      continue;
    }
    const deger = degerler[id]?.trim();
    if (d.gerekenDeger && !deger) {
      atlanan.push({
        id,
        baslik: b.baslik,
        durum: `Değer gerekli: ${d.gerekenDeger}. degerler'e { "${id}": "..." } olarak ver.`,
      });
      continue;
    }
    try {
      const istekler = d.istekler(d.gerekenDeger ? deger : undefined);
      if (!istekler.length) throw new Error("Uygulanacak istek üretilmedi.");
      const degisim = d.degisim.map((x) => ({
        ...x,
        yeni: deger && typeof x.yeni === "string" ? x.yeni.replaceAll(YER_TUTUCU, deger) : x.yeni,
      }));
      uygulanacak.push({ id, baslik: b.baslik, degisim, istekler });
    } catch (e) {
      atlanan.push({ id, baslik: b.baslik, durum: `Düzeltme hazırlanamadı: ${(e as Error).message}` });
    }
  }

  const ek = eksikVeri ? { toplama_hatalari: toplamaHatalari } : {};

  if (!uygulanacak.length) {
    return { durum: "Uygulanabilir düzeltme yok.", atlanan, ...ek };
  }

  if (girdi.onayla !== true) {
    return {
      ...onayIste("appstore__hesap_duzelt", `${uygulanacak.length} sorun düzeltilecek.`, {
        duzeltilecek: uygulanacak.map(({ id, baslik, degisim }) => ({ id, baslik, degisim })),
        atlanan,
      }),
      ...ek,
    };
  }

  const sonuc: Record<string, unknown>[] = [];
  for (const u of uygulanacak) {
    let adim = 0;
    try {
      for (const istek of u.istekler) {
        await cagir(istek);
        adim++;
      }
      sonuc.push({ id: u.id, baslik: u.baslik, durum: "uygulandı" });
    } catch (e) {
      sonuc.push({
        id: u.id,
        baslik: u.baslik,
        durum: "hata",
        hata: (e as Error).message,
        uygulanan_adim: `${adim}/${u.istekler.length}`,
      });
    }
  }

  return {
    sonuc,
    atlanan,
    not: "appstore__hesap_sagligi'nı tekrar çalıştırıp kontrol et.",
    ...ek,
  };
}
