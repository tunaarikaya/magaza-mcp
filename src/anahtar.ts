/**
 * Etkileşimsiz anahtar kaydı.
 *
 * `kur` sihirbazının soru-cevap kısmının komut satırı karşılığı. Bir yapay
 * zekâ ajanı kullanıcı adına kurulumu baştan sona yapabilsin diye var:
 * ajan dosyanın YOLUNU verir, anahtarın içeriğini hiç görmeden bu komut
 * dosyayı okur, Apple/Google'a karşı doğrular ve kasaya yazar.
 *
 * Kullanıcı dosya yolu yerine anahtarı panosuna kopyaladıysa `-` verilir ve
 * içerik stdin'den okunur:
 *
 *     pbpaste | npx magaza-mcp anahtar --play-json -
 *
 * Böylece anahtar borudan geçer; ajanın bağlamına yine girmez.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { appleDogrula, playDogrula } from "./dogrula.js";
import { onbellegiTemizle as appleOnbellegiTemizle, type AppleKimlik } from "./kimlik/apple.js";
import { kasaNerede, oku, sil, yaz } from "./kimlik/kasa.js";

/** `--ad deger` biçimindeki bayrakları okur. */
function bayrak(ad: string): string | undefined {
  const i = process.argv.indexOf(`--${ad}`);
  if (i === -1) return undefined;
  const deger = process.argv[i + 1];
  return deger && !deger.startsWith("--") ? deger : undefined;
}

/** `~`, tırnak ve göreli yol karmaşasını temizler. */
function yoluCoz(ham: string): string {
  return resolve(ham.trim().replace(/^['"]|['"]$/g, "").replace(/^~/, homedir()));
}

/**
 * Dosyayı okur. Yol `-` ise içerik stdin'den gelir.
 *
 * Okunan metin bu fonksiyondan çıkıp kasaya gider; hiçbir yerde ekrana
 * basılmaz, günlüğe yazılmaz.
 */
function icerikOku(yol: string): { icerik: string; kaynak: string } | { hata: string } {
  if (yol === "-") {
    try {
      const icerik = readFileSync(0, "utf8");
      if (!icerik.trim()) return { hata: "stdin boş geldi — boruya bir şey akmadı." };
      return { icerik, kaynak: "stdin" };
    } catch {
      return { hata: "stdin okunamadı." };
    }
  }

  const tam = yoluCoz(yol);
  if (!existsSync(tam)) return { hata: `Dosya bulunamadı: ${tam}` };
  try {
    return { icerik: readFileSync(tam, "utf8"), kaynak: tam };
  } catch {
    return { hata: `Dosya okunamadı: ${tam}` };
  }
}

const KULLANIM = `
  Kullanım:
    magaza-mcp anahtar --apple-p8 <yol|-> --issuer-id <ID> [--key-id <ID>]
    magaza-mcp anahtar --play-json <yol|->
    magaza-mcp anahtar --sil appstore|play

  --key-id verilmezse dosya adından okunmaya çalışılır (AuthKey_XXXX.p8).
  Yol yerine "-" verilirse içerik stdin'den okunur.
  --json makine okunur çıktı verir.
`;

type Rapor = Record<string, unknown>;

export async function anahtarKomutu(): Promise<void> {
  const jsonCikti = process.argv.includes("--json");
  const rapor: Rapor = {};
  const bitir = (basarili: boolean) => {
    if (jsonCikti) {
      console.log(JSON.stringify({ tamam: basarili, kasa: kasaNerede(), ...rapor }, null, 2));
    }
    if (!basarili) process.exit(1);
  };

  const soyle = (metin: string) => {
    if (!jsonCikti) console.log(metin);
  };

  /* ---- silme ---- */

  const silinecek = bayrak("sil");
  if (silinecek) {
    if (silinecek === "appstore") {
      sil("apple_key_id");
      sil("apple_issuer_id");
      sil("apple_ozel_anahtar");
      appleOnbellegiTemizle();
    } else if (silinecek === "play") {
      sil("play_servis_hesabi");
    } else {
      console.error(`Bilinmeyen mağaza: ${silinecek}. appstore veya play olmalı.`);
      process.exit(1);
    }
    rapor.silinen = silinecek;
    soyle(`\n  ✓ ${silinecek} anahtarı kasadan silindi.\n`);
    bitir(true);
    return;
  }

  const p8 = bayrak("apple-p8");
  const playJson = bayrak("play-json");

  if (!p8 && !playJson) {
    console.error(KULLANIM);
    process.exit(1);
  }

  let hepsiTamam = true;

  /* ---- App Store Connect ---- */

  if (p8) {
    const sonuc = await appleKaydet(p8, soyle);
    rapor.appstore = sonuc;
    if (!sonuc.tamam) hepsiTamam = false;
  }

  /* ---- Google Play ---- */

  if (playJson) {
    const sonuc = await playKaydet(playJson, soyle);
    rapor.play = sonuc;
    if (!sonuc.tamam) hepsiTamam = false;
  }

  bitir(hepsiTamam);
}

/* ------------------------------------------------------------------ */

async function appleKaydet(
  yol: string,
  soyle: (m: string) => void,
): Promise<{ tamam: boolean; mesaj?: string; uygulama_sayisi?: number; key_id?: string }> {
  const okunan = icerikOku(yol);
  if ("hata" in okunan) {
    soyle(`\n  ✗ App Store Connect — ${okunan.hata}\n`);
    return { tamam: false, mesaj: okunan.hata };
  }

  const ozelAnahtar = okunan.icerik;
  if (!ozelAnahtar.includes("BEGIN PRIVATE KEY")) {
    const mesaj = "Bu bir .p8 özel anahtar dosyasına benzemiyor.";
    soyle(`\n  ✗ App Store Connect — ${mesaj}\n`);
    return { tamam: false, mesaj };
  }

  // Key ID bayrakta yoksa dosya adından okunur: AuthKey_ABC123DEFG.p8
  const dosyadan = okunan.kaynak.match(/AuthKey_([A-Z0-9]{8,12})\.p8$/i)?.[1]?.toUpperCase();
  const keyId = (bayrak("key-id") || dosyadan || "").trim();
  const issuerId = (bayrak("issuer-id") || "").trim();

  if (!keyId) {
    const mesaj =
      "Key ID gerekiyor. Dosya adından okunamadı, --key-id ile ver. " +
      "App Store Connect → Kullanıcılar ve Erişim → Entegrasyonlar'da yazar.";
    soyle(`\n  ✗ App Store Connect — ${mesaj}\n`);
    return { tamam: false, mesaj };
  }
  if (!issuerId) {
    const mesaj =
      "Issuer ID gerekiyor (--issuer-id). Anahtar listesinin üstünde yazan UUID.";
    soyle(`\n  ✗ App Store Connect — ${mesaj}\n`);
    return { tamam: false, mesaj };
  }

  const kimlik: AppleKimlik = { keyId, issuerId, ozelAnahtar };
  const sonuc = await appleDogrula(kimlik);

  if (!sonuc.tamam) {
    soyle(`\n  ✗ App Store Connect — ${sonuc.mesaj}\n`);
    return { tamam: false, mesaj: sonuc.mesaj, key_id: keyId };
  }

  yaz("apple_key_id", keyId);
  yaz("apple_issuer_id", issuerId);
  yaz("apple_ozel_anahtar", ozelAnahtar);
  appleOnbellegiTemizle();

  soyle(
    `\n  ✓ App Store Connect bağlandı — ${sonuc.adet} uygulama görüldü` +
      `\n    Anahtar ${kasaNerede()} içinde (Key ID …${keyId.slice(-4)})\n`,
  );
  return { tamam: true, uygulama_sayisi: sonuc.adet, key_id: `…${keyId.slice(-4)}` };
}

async function playKaydet(
  yol: string,
  soyle: (m: string) => void,
): Promise<{
  tamam: boolean;
  mesaj?: string;
  uyari?: string;
  uygulama_sayisi?: number;
  servis_hesabi?: string;
}> {
  const okunan = icerikOku(yol);
  if ("hata" in okunan) {
    soyle(`\n  ✗ Google Play — ${okunan.hata}\n`);
    return { tamam: false, mesaj: okunan.hata };
  }

  let hesap: any;
  try {
    hesap = JSON.parse(okunan.icerik);
  } catch {
    const mesaj = "Dosya geçerli bir JSON değil.";
    soyle(`\n  ✗ Google Play — ${mesaj}\n`);
    return { tamam: false, mesaj };
  }

  if (!hesap?.client_email || !hesap?.private_key) {
    const mesaj =
      "Bu bir servis hesabı anahtarı değil (client_email ve private_key alanları yok).";
    soyle(`\n  ✗ Google Play — ${mesaj}\n`);
    return { tamam: false, mesaj };
  }

  // Doğrulama kasadan okuyor; önce yazıp başarısız olursa eskisini geri koyuyoruz.
  const onceki = oku("play_servis_hesabi");
  yaz("play_servis_hesabi", JSON.stringify(hesap));

  const sonuc = await playDogrula();
  if (!sonuc.tamam) {
    if (onceki) yaz("play_servis_hesabi", onceki);
    else sil("play_servis_hesabi");
    soyle(`\n  ✗ Google Play — ${sonuc.mesaj}\n`);
    return { tamam: false, mesaj: sonuc.mesaj, servis_hesabi: hesap.client_email };
  }

  soyle(
    `\n  ✓ Google Play bağlandı` +
      (sonuc.adet === undefined ? "" : ` — ${sonuc.adet} uygulama görüldü`) +
      `\n    ${hesap.client_email}` +
      `\n    Anahtar ${kasaNerede()} içinde` +
      (sonuc.uyari ? `\n    ! ${sonuc.uyari}` : "") +
      "\n",
  );
  return {
    tamam: true,
    ...(sonuc.adet === undefined ? {} : { uygulama_sayisi: sonuc.adet }),
    ...(sonuc.uyari ? { uyari: sonuc.uyari } : {}),
    servis_hesabi: hesap.client_email,
  };
}
