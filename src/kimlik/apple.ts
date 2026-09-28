/**
 * App Store Connect kimlik doğrulaması.
 *
 * Apple, her isteğin ES256 ile imzalanmış kısa ömürlü bir JWT taşımasını
 * ister. Anahtar (.p8) kasada durur; buradan okunur, token üretilir ve
 * süresi dolana kadar bellekte tutulur.
 */
import { createSign } from "node:crypto";
import { oku } from "./kasa.js";

/** Apple'ın üst sınırı 20 dakika; kenardan dönmemek için 18 kullanıyoruz. */
const OMUR_SANIYE = 18 * 60;

export type AppleKimlik = {
  keyId: string;
  issuerId: string;
  ozelAnahtar: string; // .p8 dosyasının PEM içeriği
};

let onbellek: { token: string; bitis: number; parmakIzi: string } | null = null;

function base64url(veri: Buffer | string): string {
  return Buffer.from(veri)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * .p8 içeriğini Node'un kabul edeceği hâle getirir.
 *
 * Anahtar kopyala-yapıştır ile geldiğinde satır sonları çoğu zaman düz metin
 * "\n" dizisine dönüşür, başına BOM veya tırnak takılır. Bu hâliyle imzalama
 * "unsupported" diye patlar; sebebi de görünmez.
 */
function pemDuzelt(ham: string): string {
  return ham
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\\r\\n|\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .trim();
}

/** Kasadaki Apple kimlik bilgilerini okur. Eksikse null döner. */
export function kimlikOku(): AppleKimlik | null {
  const keyId = oku("apple_key_id");
  const issuerId = oku("apple_issuer_id");
  const ozelAnahtar = oku("apple_ozel_anahtar");
  if (!keyId || !issuerId || !ozelAnahtar) return null;
  return {
    keyId: keyId.trim(),
    issuerId: issuerId.trim(),
    ozelAnahtar: pemDuzelt(ozelAnahtar),
  };
}

/**
 * İmzalı bir JWT üretir.
 *
 * ES256 imzası JWT'de ham r||s (64 bayt) biçiminde beklenir; Node varsayılan
 * olarak DER üretir, bu yüzden `dsaEncoding: "ieee-p1363"` şart.
 */
export function tokenUret(kimlik: AppleKimlik): string {
  const anahtar = pemDuzelt(kimlik.ozelAnahtar);
  if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(anahtar)) {
    throw new Error(
      "Apple özel anahtarı PEM biçiminde görünmüyor.\n" +
        "App Store Connect'ten indirdiğin AuthKey_XXXXXXXX.p8 dosyasının tamamını " +
        "(-----BEGIN PRIVATE KEY----- satırı dâhil) ver.",
    );
  }

  const simdi = Math.floor(Date.now() / 1000);

  const baslik = base64url(
    JSON.stringify({ alg: "ES256", kid: kimlik.keyId, typ: "JWT" }),
  );
  const govde = base64url(
    JSON.stringify({
      iss: kimlik.issuerId,
      iat: simdi,
      exp: simdi + OMUR_SANIYE,
      aud: "appstoreconnect-v1",
    }),
  );

  const imzalanacak = `${baslik}.${govde}`;
  const imzalayici = createSign("SHA256");
  imzalayici.update(imzalanacak);
  imzalayici.end();

  let imza: Buffer;
  try {
    imza = imzalayici.sign({ key: anahtar, dsaEncoding: "ieee-p1363" });
  } catch (hata) {
    throw new Error(
      "Apple özel anahtarı ile imzalanamadı. Dosya bozuk olabilir ya da .p8 " +
        "yerine başka bir anahtar verilmiş olabilir.\n" +
        `Ayrıntı: ${(hata as Error).message}`,
    );
  }

  // ES256 imzası 64 bayt (r||s) olmalı; değilse anahtar P-256 değildir.
  if (imza.length !== 64) {
    throw new Error(
      "Üretilen imza ES256 için beklenen 64 baytta değil. App Store Connect " +
        "anahtarları P-256 eğrisini kullanır; verilen anahtar başka bir eğriye ait.",
    );
  }

  return `${imzalanacak}.${base64url(imza)}`;
}

/** Geçerli bir token döndürür; gerekiyorsa yenisini üretir. */
export function gecerliToken(): string {
  const simdi = Math.floor(Date.now() / 1000);

  const kimlik = kimlikOku();
  if (!kimlik) {
    throw new Error(
      "App Store Connect kimlik bilgisi bulunamadı.\n" +
        "Kurulumu çalıştır:  npx magaza-mcp kur",
    );
  }

  // Önbellek kimliğe bağlı: kurulum sırasında anahtar değişirse eski token
  // sessizce kullanılmaya devam etmesin.
  const parmakIzi = `${kimlik.keyId}:${kimlik.issuerId}`;
  if (onbellek && onbellek.parmakIzi === parmakIzi && onbellek.bitis - 60 > simdi) {
    return onbellek.token;
  }

  const token = tokenUret(kimlik);
  onbellek = { token, bitis: simdi + OMUR_SANIYE, parmakIzi };
  return token;
}

/** Kimlik bilgisi değişince önbelleği boşaltır (kurulum sonrası). */
export function onbellegiTemizle(): void {
  onbellek = null;
}
