/**
 * Tarayıcı testleri.
 *
 * Buradaki asıl derdimiz sınıflandırma: doğru anahtarı bulmak yetmez, yanlış
 * türdekini "bu da olur" diye önermemek de gerekir. Bir ajan bu çıktıya bakıp
 * kullanıcı adına dosya seçeceği için yanlış sınıflandırma doğrudan hatalı
 * kuruluma dönüşür.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { taraKokler, type Bulgu } from "../src/tara.js";

/** İmzalamada kullanılmayan, yalnızca biçimi doğru olan sahte anahtar gövdesi. */
const SAHTE_PEM =
  "-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg\n-----END PRIVATE KEY-----\n";

const kok = mkdtempSync(join(tmpdir(), "magaza-mcp-tara-"));
after(() => rmSync(kok, { recursive: true, force: true }));

function dosya(ad: string, icerik: string): string {
  const yol = join(kok, ad);
  writeFileSync(yol, icerik);
  return yol;
}

function servisHesabi(ekler: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "service_account",
    project_id: "ornek-proje",
    client_email: "yayin@ornek-proje.iam.gserviceaccount.com",
    private_key: SAHTE_PEM,
    ...ekler,
  });
}

const bul = (bulgular: Bulgu[], ad: string) =>
  bulgular.find((b) => b.yol.endsWith(ad));

describe("taraKokler", () => {
  it("App Store API anahtarını yüksek güvenle bulur ve Key ID'yi adından okur", () => {
    dosya("AuthKey_ABC123DEFG.p8", SAHTE_PEM);
    const b = bul(taraKokler([kok]), "AuthKey_ABC123DEFG.p8");

    assert.ok(b, "anahtar bulunamadı");
    assert.equal(b.tur, "appstore");
    assert.equal(b.guven, "yuksek");
    assert.equal(b.key_id, "ABC123DEFG");
    assert.equal(b.uyari, undefined);
  });

  it("StoreKit abonelik anahtarını düşük güvenle işaretler", () => {
    dosya("SubscriptionKey_7RQA373736.p8", SAHTE_PEM);
    const b = bul(taraKokler([kok]), "SubscriptionKey_7RQA373736.p8");

    assert.ok(b);
    assert.equal(b.guven, "dusuk");
    assert.match(b.uyari ?? "", /StoreKit/);
    assert.equal(b.key_id, undefined, "StoreKit anahtarından Key ID okunmamalı");
  });

  it("servis hesabını bulur, e-postasını ve projesini çıkarır", () => {
    dosya("hesap.json", servisHesabi());
    const b = bul(taraKokler([kok]), "hesap.json");

    assert.ok(b);
    assert.equal(b.tur, "play");
    assert.equal(b.guven, "yuksek");
    assert.equal(b.servis_hesabi, "yayin@ornek-proje.iam.gserviceaccount.com");
    assert.equal(b.proje, "ornek-proje");
  });

  it("Firebase admin hesabını düşük güvenle işaretler", () => {
    dosya(
      "firebase.json",
      servisHesabi({ client_email: "firebase-adminsdk-x@proje.iam.gserviceaccount.com" }),
    );
    const b = bul(taraKokler([kok]), "firebase.json");

    assert.ok(b);
    assert.equal(b.guven, "dusuk");
    assert.match(b.uyari ?? "", /Firebase/);
  });

  it("anahtar olmayan dosyaları hiç döndürmez", () => {
    dosya("notlar.txt", "burada anahtar yok");
    dosya("package-benzeri.json", JSON.stringify({ name: "bir-paket", version: "1.0.0" }));
    dosya("bos.p8", "merhaba"); // .p8 uzantılı ama PEM değil
    dosya("bozuk.json", "{ bu json değil");

    const bulgular = taraKokler([kok]);
    for (const ad of ["notlar.txt", "package-benzeri.json", "bos.p8", "bozuk.json"]) {
      assert.equal(bul(bulgular, ad), undefined, `${ad} bulgu olarak dönmemeli`);
    }
  });

  it("çıktının hiçbir alanında anahtarın içeriği geçmez", () => {
    dosya("AuthKey_ZZZ999YYY8.p8", SAHTE_PEM);
    dosya("gizli-hesap.json", servisHesabi());

    const dokum = JSON.stringify(taraKokler([kok]));
    assert.ok(!dokum.includes("BEGIN PRIVATE KEY"), "PEM gövdesi çıktıya sızmış");
    assert.ok(!dokum.includes("MIGTAgEAMBMGByqGSM49"), "anahtar gövdesi çıktıya sızmış");
  });

  it("yüksek güvenli bulguları başa alır", () => {
    const bulgular = taraKokler([kok]).filter((b) => b.tur === "appstore");
    const ilkDusuk = bulgular.findIndex((b) => b.guven === "dusuk");
    const sonYuksek = bulgular.map((b) => b.guven).lastIndexOf("yuksek");

    if (ilkDusuk !== -1 && sonYuksek !== -1) {
      assert.ok(sonYuksek < ilkDusuk, "düşük güvenli bulgu yüksek olanın önüne geçmiş");
    }
  });

  it("atlanan klasörlerin içine girmez", () => {
    const modul = join(kok, "node_modules", "bir-paket");
    mkdirSync(modul, { recursive: true });
    writeFileSync(join(modul, "AuthKey_NODEMOD123.p8"), SAHTE_PEM);

    assert.equal(bul(taraKokler([kok]), "AuthKey_NODEMOD123.p8"), undefined);
  });

  it("okunamayan klasör verilince patlamaz", () => {
    assert.doesNotThrow(() => taraKokler([join(kok, "hiç-olmayan-klasör")]));
  });
});
