/**
 * Kasa testleri.
 *
 * Bu dosyanın varlık sebebi gerçek bir hata: macOS'un `security` aracı, içinde
 * satır sonu olan bir parolayı düz metin yerine onaltılık döküm olarak geri
 * veriyor. Çok satırlı bir .p8 anahtarı tam olarak bu tuzağa düşüyordu ve
 * anahtar bozuk okunuyordu. Gidiş-dönüş testi o hatanın geri gelmesini önler.
 *
 * Test kendi anahtar adını kullanır ve sonunda siler; gerçek kimlik
 * bilgilerine dokunmaz.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { kasaNerede, oku, sil, yaz } from "../src/kimlik/kasa.js";

const AD = "test_gidis_donus";

after(() => sil(AD));

describe("kasa", () => {
  it("tek satırlık değeri aynen geri verir", () => {
    yaz(AD, "ABC123DEFG");
    assert.equal(oku(AD), "ABC123DEFG");
  });

  it("çok satırlı PEM'i bozmadan saklar", () => {
    const pem =
      "-----BEGIN PRIVATE KEY-----\n" +
      "satir1AAAA\nsatir2BBBB\nsatir3CCCC\n" +
      "-----END PRIVATE KEY-----\n";

    yaz(AD, pem);
    assert.equal(oku(AD), pem);
  });

  it("JSON servis hesabını bozmadan saklar", () => {
    const hesap = JSON.stringify({
      type: "service_account",
      client_email: "yayin@proje.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
    });

    yaz(AD, hesap);
    assert.equal(oku(AD), hesap);
    assert.deepEqual(JSON.parse(oku(AD) as string).client_email, "yayin@proje.iam.gserviceaccount.com");
  });

  it("onaltılığa benzeyen düz metni bozmaz", () => {
    // Kasadan çıkan metin hex'e benziyorsa çözülür; gerçek bir değer yanlışlıkla
    // çözülürse anahtar bozulur. İşaret sistemi bunu engellemeli.
    yaz(AD, "abcdef0123456789");
    assert.equal(oku(AD), "abcdef0123456789");
  });

  it("üzerine yazar, siler, silinince null döner", () => {
    yaz(AD, "birinci");
    yaz(AD, "ikinci");
    assert.equal(oku(AD), "ikinci");

    sil(AD);
    assert.equal(oku(AD), null);
  });

  it("nerede sakladığını söyler", () => {
    assert.ok(kasaNerede().length > 0);
  });
});
