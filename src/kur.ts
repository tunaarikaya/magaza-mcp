/**
 * Kurulum sihirbazı.
 *
 * Tek amacı var: kullanıcı hiçbir JSON dosyası açmadan, anahtarını hiçbir
 * yere yapıştırmadan iki mağazayı da bağlayabilsin.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { onbellegiTemizle as appleOnbellegiTemizle, type AppleKimlik } from "./kimlik/apple.js";
import { appleDogrula, playDogrula } from "./dogrula.js";
import { kasaNerede, yaz } from "./kimlik/kasa.js";
import { ISTEMCILER, kur as istemcilereKur, kuruluMu, sunucuGirdisi } from "./istemciler.js";

/* ---------------- terminal süsleri ---------------- */

const renkli = stdout.isTTY && !process.env.NO_COLOR;
const b = (m: string) => (renkli ? `\x1b[1m${m}\x1b[0m` : m);
const soluk = (m: string) => (renkli ? `\x1b[2m${m}\x1b[0m` : m);
const yesil = (m: string) => (renkli ? `\x1b[32m${m}\x1b[0m` : m);
const kirmizi = (m: string) => (renkli ? `\x1b[31m${m}\x1b[0m` : m);
const sari = (m: string) => (renkli ? `\x1b[33m${m}\x1b[0m` : m);

const tik = yesil("✓");
const capraz = kirmizi("✗");

/** Ev dizinini ~ ile kısaltır; ekran görüntüsünde kullanıcı adı görünmesin. */
const kisalt = (yol: string) => yol.replace(homedir(), "~");

/* ---------------- ana akış ---------------- */

export async function kurulumSihirbazi(): Promise<void> {
  const ara = createInterface({ input: stdin, output: stdout });
  const sor = (soru: string) => ara.question(soru);

  const evetMi = async (soru: string, varsayilan = true) => {
    const ipucu = varsayilan ? "E/h" : "e/H";
    const cevap = (await sor(`${soru} ${soluk(`[${ipucu}]`)} `)).trim().toLowerCase();
    if (!cevap) return varsayilan;
    return cevap.startsWith("e") || cevap.startsWith("y");
  };

  console.log();
  console.log(b("  Mağaza MCP kurulumu"));
  console.log(soluk("  App Store Connect + Google Play, tek kurulumda"));
  console.log();

  try {
    /* ---- 1. Hangi mağazalar ---- */

    console.log(b("  1. Hangi mağazaları bağlayalım?"));
    console.log();
    const appstoreIstenen = await evetMi("     App Store Connect (iOS / macOS)?");
    const playIstenen = await evetMi("     Google Play (Android)?");
    console.log();

    if (!appstoreIstenen && !playIstenen) {
      console.log(kirmizi("  En az bir mağaza seçmelisin. Kurulum iptal edildi."));
      return;
    }

    const magazalar: string[] = [];

    /* ---- 2. App Store Connect ---- */

    if (appstoreIstenen) {
      console.log(b("  2. App Store Connect anahtarı"));
      console.log(
        soluk(
          "     App Store Connect → Kullanıcılar ve Erişim → Entegrasyonlar\n" +
            "     Rol olarak App Manager yeterlidir; Admin gerekmez.",
        ),
      );
      console.log();

      const keyId = (await sor("     Key ID: ")).trim();
      const issuerId = (await sor("     Issuer ID: ")).trim();

      let p8Yolu = (await sor("     .p8 dosyasının yolu: ")).trim();
      p8Yolu = resolve(p8Yolu.replace(/^~/, homedir()).replace(/^['"]|['"]$/g, ""));

      if (!existsSync(p8Yolu)) {
        console.log(`     ${capraz} Dosya bulunamadı: ${kisalt(p8Yolu)}`);
        return;
      }

      const ozelAnahtar = readFileSync(p8Yolu, "utf8");
      if (!ozelAnahtar.includes("BEGIN PRIVATE KEY")) {
        console.log(`     ${capraz} Bu bir .p8 özel anahtar dosyasına benzemiyor.`);
        return;
      }

      const kimlik: AppleKimlik = { keyId, issuerId, ozelAnahtar };

      stdout.write("     Apple'a bağlanılıyor... ");
      const sonuc = await appleDogrula(kimlik);

      if (!sonuc.tamam) {
        console.log(capraz);
        console.log(`     ${kirmizi(sonuc.mesaj ?? "Bilinmeyen hata.")}`);
        return;
      }

      console.log(`${tik} ${soluk(`${sonuc.adet} uygulama görüldü`)}`);

      yaz("apple_key_id", keyId);
      yaz("apple_issuer_id", issuerId);
      yaz("apple_ozel_anahtar", ozelAnahtar);
      // Aynı süreç içinde anahtar değiştiyse eski token bellekte kalmasın.
      appleOnbellegiTemizle();
      console.log(`     ${tik} Anahtar kaydedildi ${soluk(`(${kasaNerede()})`)}`);
      console.log();

      magazalar.push("appstore");
    }

    /* ---- 3. Google Play ---- */

    if (playIstenen) {
      console.log(b(`  ${appstoreIstenen ? 3 : 2}. Google Play servis hesabı`));
      console.log(
        soluk(
          "     Google Cloud Console'da servis hesabı oluştur, JSON anahtarını indir,\n" +
            "     sonra Play Console → Kullanıcılar ve izinler'den bu hesabı davet et.",
        ),
      );
      console.log();

      // Sık kullanılan bir konumu varsayılan olarak öner.
      const alisilmis = join(homedir(), ".config", "play-store", "service-account-key.json");
      const ipucu = existsSync(alisilmis) ? ` ${soluk(`[${kisalt(alisilmis)}]`)}` : "";

      let jsonYolu = (await sor(`     Servis hesabı JSON yolu${ipucu}: `)).trim();
      if (!jsonYolu && existsSync(alisilmis)) jsonYolu = alisilmis;
      jsonYolu = resolve(jsonYolu.replace(/^~/, homedir()).replace(/^['"]|['"]$/g, ""));

      if (!existsSync(jsonYolu)) {
        console.log(`     ${capraz} Dosya bulunamadı: ${kisalt(jsonYolu)}`);
        return;
      }

      const ham = readFileSync(jsonYolu, "utf8");
      let hesap: any;
      try {
        hesap = JSON.parse(ham);
      } catch {
        console.log(`     ${capraz} Dosya geçerli bir JSON değil.`);
        return;
      }

      if (!hesap.client_email || !hesap.private_key) {
        console.log(
          `     ${capraz} Bu bir servis hesabı anahtarı değil ` +
            "(client_email ve private_key alanları yok).",
        );
        return;
      }

      stdout.write("     Google'a bağlanılıyor... ");
      yaz("play_servis_hesabi", JSON.stringify(hesap));

      const sonuc = await playDogrula();
      if (!sonuc.tamam) {
        console.log(capraz);
        console.log(`     ${kirmizi(sonuc.mesaj ?? "Bilinmeyen hata.")}`);
        return;
      }

      console.log(
        `${tik} ${soluk(sonuc.adet === undefined ? "bağlantı kuruldu" : `${sonuc.adet} uygulama görüldü`)}`,
      );
      if (sonuc.uyari) console.log(`     ${sari("!")} ${sonuc.uyari}`);
      console.log(`     ${tik} Anahtar kaydedildi ${soluk(`(${kasaNerede()})`)}`);
      console.log();

      magazalar.push("play");
    }

    /* ---- 4. İstemciler ---- */

    const adim = 1 + (appstoreIstenen ? 1 : 0) + (playIstenen ? 1 : 0) + 1;
    console.log(b(`  ${adim}. Hangi uygulamalara kurulsun?`));
    console.log();

    const secilenler = [];
    for (const istemci of ISTEMCILER) {
      const kurulu = kuruluMu(istemci);
      const etiket = kurulu ? istemci.isim : `${istemci.isim} ${soluk("(kurulu değil)")}`;
      if (await evetMi(`     ${etiket}?`, kurulu)) {
        secilenler.push(istemci);
      }
    }
    console.log();

    if (secilenler.length === 0) {
      console.log(sari("  Hiçbir istemci seçilmedi. Anahtarlar kaydedildi ama"));
      console.log(sari("  sunucu hiçbir yere bağlanmadı. İstersen tekrar çalıştır."));
      return;
    }

    console.log();
    const saltOkunur = await evetMi(
      "     Salt-okunur kurulsun mu? (veri değiştiren araçlar hiç yüklenmez)",
      false,
    );
    console.log();

    const sonuclar = istemcilereKur(
      secilenler,
      sunucuGirdisi(magazalar, saltOkunur),
    );

    for (const s of sonuclar) {
      if (s.basarili) {
        console.log(`     ${tik} ${s.istemci.isim} ${soluk(kisalt(s.istemci.yol))}`);
      } else {
        console.log(`     ${capraz} ${s.istemci.isim} — ${kirmizi(s.hata || "bilinmeyen hata")}`);
      }
    }

    /* ---- 5. Özet ---- */

    const basarili = sonuclar.filter((s) => s.basarili);
    console.log();
    console.log(b("  Kurulum tamam."));
    console.log();
    console.log(
      `  Bağlanan mağazalar : ${magazalar
        .map((m) => (m === "appstore" ? "App Store Connect" : "Google Play"))
        .join(" + ")}`,
    );
    console.log(`  Anahtarların yeri  : ${kasaNerede()}`);
    console.log(`  Kurulan uygulama   : ${basarili.length}`);
    console.log();
    console.log(sari("  Açık olan uygulamaları yeniden başlat, sonra şunu sor:"));
    console.log();
    console.log(
      b(
        magazalar.length === 2
          ? '    "İki mağazadaki uygulamalarımı listele"'
          : magazalar[0] === "appstore"
            ? '    "App Store uygulamalarımı listele"'
            : '    "Play uygulamalarımı listele"',
      ),
    );
    console.log();
  } finally {
    ara.close();
  }
}
