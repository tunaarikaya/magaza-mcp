#!/usr/bin/env node
/**
 * Apple ve Google'ın resmî spesifikasyonlarını tazeler, katalogları yeniden üretir.
 *
 *   npm run spec:guncelle
 *
 * Apple spesifikasyonu bir zip içinde geliyor; Google'ınkiler doğrudan JSON.
 * İndirilen her dosya yerine yazılmadan önce ayrıştırılıp doğrulanır, böylece
 * yarıda kesilen bir indirme çalışan kataloğu bozmaz.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const kok = join(dirname(fileURLToPath(import.meta.url)), "..");
const specDizini = join(kok, "spec");

const APPLE_ZIP =
  "https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip";

const GOOGLE = [
  {
    ad: "play.json",
    adres: "https://androidpublisher.googleapis.com/$discovery/rest?version=v3",
    etiket: "Android Publisher v3",
  },
  {
    ad: "play-reporting.json",
    adres:
      "https://playdeveloperreporting.googleapis.com/$discovery/rest?version=v1beta1",
    etiket: "Play Developer Reporting v1beta1",
  },
];

async function jsonIndir(adres) {
  const yanit = await fetch(adres);
  if (!yanit.ok) throw new Error(`${adres} → HTTP ${yanit.status}`);
  const metin = await yanit.text();
  JSON.parse(metin); // bozuksa burada patlasın, dosyayı bozmadan
  return metin;
}

async function appleIndir() {
  const gecici = mkdtempSync(join(tmpdir(), "magaza-spec-"));
  try {
    const yanit = await fetch(APPLE_ZIP);
    if (!yanit.ok) throw new Error(`Apple spesifikasyonu → HTTP ${yanit.status}`);

    const zipYolu = join(gecici, "asc.zip");
    writeFileSync(zipYolu, Buffer.from(await yanit.arrayBuffer()));
    execFileSync("unzip", ["-o", "-q", zipYolu, "-d", gecici], { stdio: "pipe" });

    // Zip içindeki klasör adı sürümden sürüme değişiyor; .json olanı arıyoruz.
    const bulunan = readdirSync(gecici, { recursive: true }).find(
      (d) => typeof d === "string" && d.endsWith(".json"),
    );
    if (!bulunan) throw new Error("Zip içinde .json spesifikasyon dosyası bulunamadı.");

    const icerik = readFileSync(join(gecici, bulunan), "utf8");
    const spec = JSON.parse(icerik);

    writeFileSync(join(specDizini, "appstore-openapi.json"), icerik);
    return spec.info?.version ?? "?";
  } finally {
    rmSync(gecici, { recursive: true, force: true });
  }
}

const surum = await appleIndir();
console.log(`App Store Connect API ${surum} indirildi`);

for (const { ad, adres, etiket } of GOOGLE) {
  const icerik = await jsonIndir(adres);
  writeFileSync(join(specDizini, ad), icerik);
  console.log(`${etiket} indirildi`);
}

console.log();
execFileSync("node", [join(kok, "scripts", "uret-katalog.mjs")], { stdio: "inherit" });
