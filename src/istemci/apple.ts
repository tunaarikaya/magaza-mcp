/**
 * App Store Connect HTTP istemcisi.
 *
 * Apple'ın hata gövdeleri İngilizce ve çoğu zaman sebebi söylemez; burada
 * sık karşılaşılanlar Türkçeye ve "ne yapmalıyım"a çevrilir.
 */
import { gecerliToken } from "../kimlik/apple.js";

const TABAN = "https://api.appstoreconnect.apple.com";

export type Istek = {
  yontem: string;
  yol: string;
  sorgu?: Record<string, unknown>;
  govde?: unknown;
};

export async function cagir({ yontem, yol, sorgu, govde }: Istek): Promise<unknown> {
  const adres = new URL(yol.startsWith("http") ? yol : TABAN + yol);

  for (const [ad, deger] of Object.entries(sorgu || {})) {
    if (deger === undefined || deger === null) continue;
    adres.searchParams.set(ad, Array.isArray(deger) ? deger.join(",") : String(deger));
  }

  const yanit = await fetch(adres, {
    method: yontem,
    headers: {
      authorization: `Bearer ${gecerliToken()}`,
      "content-type": "application/json",
    },
    body: govde === undefined ? undefined : JSON.stringify(govde),
  });

  // 204 ve gövdesiz yanıtlar
  const metin = await yanit.text();
  if (!yanit.ok) throw new Error(hataMesaji(yanit.status, metin, yol));
  if (!metin) return { basarili: true, durum: yanit.status };

  try {
    return JSON.parse(metin);
  } catch {
    return metin;
  }
}

/** Satış/finans raporları JSON değil, gzip'li TSV döner. */
export async function raporIndir(sorgu: Record<string, unknown>): Promise<string> {
  const adres = new URL(TABAN + "/v1/salesReports");
  for (const [ad, deger] of Object.entries(sorgu)) {
    if (deger === undefined || deger === null) continue;
    adres.searchParams.set(`filter[${ad}]`, String(deger));
  }

  const yanit = await fetch(adres, {
    method: "GET",
    headers: {
      authorization: `Bearer ${gecerliToken()}`,
      accept: "application/a-gzip",
    },
  });

  if (!yanit.ok) {
    throw new Error(hataMesaji(yanit.status, await yanit.text(), "/v1/salesReports"));
  }

  const { gunzipSync } = await import("node:zlib");
  const ham = Buffer.from(await yanit.arrayBuffer());
  try {
    return gunzipSync(ham).toString("utf8");
  } catch {
    return ham.toString("utf8");
  }
}

function hataMesaji(durum: number, govde: string, yol: string): string {
  let ayrinti = govde.slice(0, 500);
  try {
    const cozulmus = JSON.parse(govde);
    if (Array.isArray(cozulmus.errors)) {
      ayrinti = cozulmus.errors
        .map((h: { title?: string; detail?: string }) =>
          [h.title, h.detail].filter(Boolean).join(" — "),
        )
        .join("\n");
    }
  } catch {
    /* düz metin olarak bırak */
  }

  const ipucu = ipuclari(durum, ayrinti, yol);
  return `App Store Connect hatası (HTTP ${durum})\n${ayrinti}${ipucu ? `\n\n→ ${ipucu}` : ""}`;
}

function ipuclari(durum: number, ayrinti: string, yol: string): string {
  if (durum === 401) {
    return (
      "Anahtar kabul edilmedi. Key ID, Issuer ID ve .p8 dosyası birbirine ait mi? " +
      "Bilgisayarın saati doğru mu? (JWT'nin ömrü 20 dakika, kaymış saat token'ı geçersiz kılar.)"
    );
  }
  if (durum === 403) {
    if (yol.includes("/users") || yol.includes("/userInvitations")) {
      return "Kullanıcı yönetimi için anahtarın rolü Admin olmalı. App Manager yetmez.";
    }
    if (yol.includes("analytics")) {
      return (
        "Analitik raporları için anahtarın Admin olması gerekebilir; " +
        "yeni bir rapor türü ilk kez istendiğinde Apple Admin arar."
      );
    }
    return (
      "Anahtarın bu işlem için yetkisi yok. Günlük yayın işleri için App Manager " +
      "yeterlidir; sözleşme, vergi ve banka bilgileri ise yalnızca Hesap Sahibi'nde " +
      "olup hiçbir API anahtarıyla okunamaz."
    );
  }
  if (durum === 404) {
    return "Kaynak bulunamadı. Kimlik (id) doğru mu, silinmiş olabilir mi?";
  }
  if (durum === 409) {
    return (
      "Çakışma. Genelde kaynağın o anki durumu bu işleme izin vermiyor demektir — " +
      "örneğin incelemedeki bir sürümü düzenlemeye çalışmak."
    );
  }
  if (durum === 429) {
    return "Apple hız sınırına takıldın. Bir süre bekleyip tekrar dene.";
  }
  if (durum >= 500) {
    return "Apple tarafında geçici bir sorun. Birazdan tekrar dene.";
  }
  return "";
}
