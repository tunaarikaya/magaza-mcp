/**
 * Komut satırı testleri.
 *
 * Gerçek çalıştırılabilir dosya çağrılır, çünkü ajanın gördüğü şey tam olarak
 * budur: çıkış kodu ve çıktı. Buradaki senaryoların hiçbiri ağa çıkmaz ve
 * kasaya dokunmaz — hepsi doğrulamadan önce reddedilen girdiler.
 *
 * En kritik iddia sonda: anahtarın içeriği hiçbir çıktıda görünmez.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";

const burasi = dirname(fileURLToPath(import.meta.url));
const CLI = join(burasi, "..", "src", "cli.js"); // dist/test → dist/src

const kok = mkdtempSync(join(tmpdir(), "magaza-mcp-cli-"));
after(() => rmSync(kok, { recursive: true, force: true }));

/** Anahtar sızıntısını kovalayabilmek için içine iz bırakılmış sahte PEM. */
const IZ = "SIZMAMASI_GEREKEN_GOVDE";
const SAHTE_PEM = `-----BEGIN PRIVATE KEY-----\n${IZ}\n-----END PRIVATE KEY-----\n`;

function dosya(ad: string, icerik: string): string {
  const yol = join(kok, ad);
  writeFileSync(yol, icerik);
  return yol;
}

type Sonuc = { kod: number; cikti: string };

function calistir(...argumanlar: string[]): Sonuc {
  try {
    const cikti = execFileSync(process.execPath, [CLI, ...argumanlar], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { kod: 0, cikti };
  } catch (h: any) {
    return { kod: h.status ?? 1, cikti: `${h.stdout ?? ""}${h.stderr ?? ""}` };
  }
}

describe("anahtar komutu", () => {
  it("argümansız çağrılınca kullanımı gösterip hata döner", () => {
    const { kod, cikti } = calistir("anahtar");
    assert.equal(kod, 1);
    assert.match(cikti, /--apple-p8/);
    assert.match(cikti, /--play-json/);
  });

  it("olmayan dosyayı açıkça söyler", () => {
    const { kod, cikti } = calistir("anahtar", "--apple-p8", join(kok, "yok.p8"), "--issuer-id", "x");
    assert.equal(kod, 1);
    assert.match(cikti, /Dosya bulunamadı/);
  });

  it(".p8 olmayan dosyayı reddeder", () => {
    const yol = dosya("AuthKey_SAHTE12345.p8", "bu bir anahtar değil");
    const { kod, cikti } = calistir("anahtar", "--apple-p8", yol, "--issuer-id", "x");
    assert.equal(kod, 1);
    assert.match(cikti, /özel anahtar dosyasına benzemiyor/);
  });

  it("Issuer ID verilmezse ağa çıkmadan durur", () => {
    const yol = dosya("AuthKey_ABC123DEFG.p8", SAHTE_PEM);
    const { kod, cikti } = calistir("anahtar", "--apple-p8", yol);
    assert.equal(kod, 1);
    assert.match(cikti, /Issuer ID gerekiyor/);
  });

  it("Key ID dosya adından okunamıyorsa söyler", () => {
    const yol = dosya("adsiz-anahtar.p8", SAHTE_PEM);
    const { kod, cikti } = calistir("anahtar", "--apple-p8", yol, "--issuer-id", "x");
    assert.equal(kod, 1);
    assert.match(cikti, /Key ID gerekiyor/);
  });

  it("bozuk JSON'u reddeder", () => {
    const yol = dosya("bozuk.json", "{ bu json değil");
    const { kod, cikti } = calistir("anahtar", "--play-json", yol);
    assert.equal(kod, 1);
    assert.match(cikti, /geçerli bir JSON değil/);
  });

  it("servis hesabı olmayan JSON'u reddeder", () => {
    const yol = dosya("baska.json", JSON.stringify({ name: "paket", version: "1.0.0" }));
    const { kod, cikti } = calistir("anahtar", "--play-json", yol);
    assert.equal(kod, 1);
    assert.match(cikti, /servis hesabı anahtarı değil/);
  });

  it("--json ile makine okunur çıktı verir", () => {
    const yol = dosya("bozuk2.json", "{{{");
    const { cikti } = calistir("anahtar", "--play-json", yol, "--json");
    const veri = JSON.parse(cikti);
    assert.equal(veri.tamam, false);
    assert.equal(veri.play.tamam, false);
    assert.ok(typeof veri.kasa === "string");
  });

  it("hata çıktılarının hiçbirinde anahtarın içeriği geçmez", () => {
    const yol = dosya("AuthKey_IZLITEST12.p8", SAHTE_PEM);
    for (const argumanlar of [
      ["anahtar", "--apple-p8", yol],
      ["anahtar", "--apple-p8", yol, "--json"],
      ["anahtar", "--apple-p8", yol, "--key-id", "IZLITEST12"],
    ]) {
      const { cikti } = calistir(...argumanlar);
      assert.ok(!cikti.includes(IZ), `anahtar gövdesi çıktıya sızmış: ${argumanlar.join(" ")}`);
      assert.ok(!cikti.includes("BEGIN PRIVATE KEY"), "PEM başlığı çıktıya sızmış");
    }
  });
});

describe("tara komutu", () => {
  it("--json geçerli bir bulgu listesi döndürür", () => {
    const { kod, cikti } = calistir("tara", "--json");
    assert.equal(kod, 0);

    const veri = JSON.parse(cikti);
    assert.ok(Array.isArray(veri.bulgular));
    for (const b of veri.bulgular) {
      assert.ok(["appstore", "play"].includes(b.tur));
      assert.ok(["yuksek", "dusuk"].includes(b.guven));
      assert.equal(typeof b.yol, "string");
    }
  });

  it("çıktıya hiçbir anahtar gövdesi basmaz", () => {
    const { cikti } = calistir("tara", "--json");
    assert.ok(!cikti.includes("BEGIN PRIVATE KEY"));
    assert.ok(!cikti.includes("private_key"));
  });
});

describe("genel komutlar", () => {
  it("surum package.json ile aynı sürümü yazar", () => {
    const paket = createRequire(import.meta.url)("../../package.json");
    assert.equal(calistir("surum").cikti.trim(), paket.version);
  });

  it("yardim yeni komutları anlatır", () => {
    const { kod, cikti } = calistir("yardim");
    assert.equal(kod, 0);
    for (const komut of ["tara", "anahtar", "kaydet", "durum"]) {
      assert.match(cikti, new RegExp(`magaza-mcp ${komut}`));
    }
  });

  it("bilinmeyen komutta hata verir", () => {
    const { kod, cikti } = calistir("olmayan-komut");
    assert.equal(kod, 1);
    assert.match(cikti, /Bilinmeyen komut/);
  });

  it("araclar listesi 27 aracı sayar", () => {
    const { kod, cikti } = calistir("araclar");
    assert.equal(kod, 0);
    assert.match(cikti, /27 araç yüklü/);
  });
});
