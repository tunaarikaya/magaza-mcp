#!/usr/bin/env node
/**
 * Üretilmiş katalogları derleme çıktısına kopyalar.
 *
 * Kataloglar .ts değil .json olduğu için tsc onları dist'e taşımaz; çalışma
 * anında fs ile okunduklarından yanlarında bulunmaları gerekir.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const kok = join(dirname(fileURLToPath(import.meta.url)), "..");
const hedef = join(kok, "dist", "src", "katalog");

mkdirSync(hedef, { recursive: true });

for (const dosya of ["appstore.json", "play.json"]) {
  copyFileSync(join(kok, "src", "katalog", dosya), join(hedef, dosya));
}

console.log("katalog dosyaları dist'e kopyalandı");
