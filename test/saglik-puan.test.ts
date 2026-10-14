import assert from "node:assert/strict";
import { it } from "node:test";

import { puanla } from "../src/araclar/saglik/analiz.js";
import type { Bulgu, Ciddiyet } from "../src/araclar/saglik/tip.js";

const b = (ciddiyet: Ciddiyet) => ({ ciddiyet }) as Bulgu;

it("puan: boş 0, tek kritik 25, düşükler 100'e dayanmaz, sıra önemsiz", () => {
  assert.equal(puanla([]), 0);
  assert.equal(puanla([b("kritik")]), 25);
  assert.ok(puanla(Array(20).fill(b("dusuk"))) < 25);
  assert.equal(puanla([b("kritik"), b("kritik")]), 44);
  assert.equal(puanla([b("orta"), b("kritik")]), puanla([b("kritik"), b("orta")]));
});
