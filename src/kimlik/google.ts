/**
 * Google Play kimlik doğrulaması.
 *
 * Servis hesabı anahtarıyla RS256 imzalı bir JWT üretilir, Google'ın token
 * uç noktasında erişim token'ıyla takas edilir. Token süresi dolana kadar
 * bellekte tutulur.
 */
import { createSign } from "node:crypto";
import { oku } from "./kasa.js";

const TOKEN_UCU = "https://oauth2.googleapis.com/token";

export const KAPSAMLAR = [
  "https://www.googleapis.com/auth/androidpublisher",
  "https://www.googleapis.com/auth/playdeveloperreporting",
];

export type ServisHesabi = {
  client_email: string;
  private_key: string;
  project_id?: string;
};

let onbellek: { token: string; bitis: number } | null = null;

/**
 * Uçuştaki token isteği.
 *
 * İki araç aynı anda token isterse ikisi de bayat önbelleği görüp Google'a
 * ayrı ayrı gider. İkisi de geçerli token alır, yani yanlış sonuç doğmaz —
 * ama gereksiz istek ve hız sınırı riski doğar. Uçuştaki isteği paylaşarak
 * ikinci çağrıyı aynı sonuca bağlıyoruz.
 */
let ucustaki: Promise<string> | null = null;

function base64url(veri: Buffer | string): string {
  return Buffer.from(veri)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Kasadaki servis hesabını okur. Eksikse null döner. */
export function servisHesabiOku(): ServisHesabi | null {
  const ham = oku("play_servis_hesabi");
  if (!ham) return null;
  try {
    const h = JSON.parse(ham);
    if (!h.client_email || !h.private_key) return null;
    return h;
  } catch {
    return null;
  }
}

function jwtUret(hesap: ServisHesabi): string {
  const simdi = Math.floor(Date.now() / 1000);

  const baslik = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const govde = base64url(
    JSON.stringify({
      iss: hesap.client_email,
      scope: KAPSAMLAR.join(" "),
      aud: TOKEN_UCU,
      iat: simdi,
      exp: simdi + 3600,
    }),
  );

  const imzalanacak = `${baslik}.${govde}`;
  const imzalayici = createSign("RSA-SHA256");
  imzalayici.update(imzalanacak);
  imzalayici.end();

  return `${imzalanacak}.${base64url(imzalayici.sign(hesap.private_key))}`;
}

/** Geçerli bir erişim token'ı döndürür; gerekiyorsa Google'dan yenisini alır. */
export async function gecerliToken(): Promise<string> {
  const simdi = Math.floor(Date.now() / 1000);
  if (onbellek && onbellek.bitis - 120 > simdi) return onbellek.token;
  if (ucustaki) return ucustaki;

  ucustaki = tokenIste().finally(() => {
    ucustaki = null;
  });
  return ucustaki;
}

async function tokenIste(): Promise<string> {
  const simdi = Math.floor(Date.now() / 1000);

  const hesap = servisHesabiOku();
  if (!hesap) {
    throw new Error(
      "Google Play servis hesabı bulunamadı.\n" +
        "Kurulumu çalıştır:  npx magaza-mcp kur",
    );
  }

  const yanit = await fetch(TOKEN_UCU, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwtUret(hesap),
    }),
  });

  if (!yanit.ok) {
    const govde = await yanit.text();
    throw new Error(
      `Google token alınamadı (HTTP ${yanit.status}).\n` +
        cevirHata(govde) +
        "\nServis hesabının Play Console'da davet edilmiş ve izinlerinin " +
        "verilmiş olduğundan emin ol.",
    );
  }

  const veri = (await yanit.json()) as {
    access_token: string;
    expires_in: number;
  };

  onbellek = {
    token: veri.access_token,
    bitis: simdi + (veri.expires_in || 3600),
  };
  return onbellek.token;
}

/** Google'ın sık dönen hatalarını Türkçeye çevirir. */
function cevirHata(govde: string): string {
  if (govde.includes("invalid_grant")) {
    return (
      "Anahtar reddedildi. Sık sebepleri: servis hesabı anahtarı silinmiş, " +
      "sistem saati kaymış, ya da anahtar başka bir projeye ait."
    );
  }
  if (govde.includes("invalid_client")) {
    return "Servis hesabı tanınmadı. client_email ve private_key eşleşmiyor olabilir.";
  }
  return govde.slice(0, 300);
}

/** Kimlik bilgisi değişince önbelleği boşaltır (kurulum sonrası). */
export function onbellegiTemizle(): void {
  onbellek = null;
}
