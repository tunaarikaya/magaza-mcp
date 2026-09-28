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

let onbellek: { token: string; bitis: number } | null = null;

function base64url(veri: Buffer | string): string {
  return Buffer.from(veri)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Kasadaki Apple kimlik bilgilerini okur. Eksikse null döner. */
export function kimlikOku(): AppleKimlik | null {
  const keyId = oku("apple_key_id");
  const issuerId = oku("apple_issuer_id");
  const ozelAnahtar = oku("apple_ozel_anahtar");
  if (!keyId || !issuerId || !ozelAnahtar) return null;
  return { keyId, issuerId, ozelAnahtar };
}

/**
 * İmzalı bir JWT üretir.
 *
 * ES256 imzası JWT'de ham r||s (64 bayt) biçiminde beklenir; Node varsayılan
 * olarak DER üretir, bu yüzden `dsaEncoding: "ieee-p1363"` şart.
 */
export function tokenUret(kimlik: AppleKimlik): string {
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

  const imza = imzalayici.sign({
    key: kimlik.ozelAnahtar,
    dsaEncoding: "ieee-p1363",
  });

  return `${imzalanacak}.${base64url(imza)}`;
}

/** Geçerli bir token döndürür; gerekiyorsa yenisini üretir. */
export function gecerliToken(): string {
  const simdi = Math.floor(Date.now() / 1000);
  if (onbellek && onbellek.bitis - 60 > simdi) return onbellek.token;

  const kimlik = kimlikOku();
  if (!kimlik) {
    throw new Error(
      "App Store Connect kimlik bilgisi bulunamadı.\n" +
        "Kurulumu çalıştır:  npx magaza-mcp kur",
    );
  }

  const token = tokenUret(kimlik);
  onbellek = { token, bitis: simdi + OMUR_SANIYE };
  return token;
}

/** Kimlik bilgisi değişince önbelleği boşaltır (kurulum sonrası). */
export function onbellegiTemizle(): void {
  onbellek = null;
}
