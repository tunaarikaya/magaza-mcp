/**
 * Apple'ın gerçek sayfasındaki üç tuzağı, küçük bir sahte HTML parçasıyla
 * sabitler: numara+başlık arasına giren ipucu ikonu, madde id'si slug olup
 * numaranın iç `<span>`'de olduğu durum (5.1.1 tarzı), ve iç içe `<li>`
 * taşıyan kurallar (4.2.7 tarzı) — ilkinde başlık boş dönüyordu, ikincisinde
 * gövde hiç yakalanmıyordu, üçüncüsünde gövde ilk iç `</li>`'de kesiliyordu.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { htmlAyristir } from "../src/araclar/kurallar.js";

const SAHTE_SAYFA = `
<h3 id="safety"><span id="1"></span>1. Safety</h3>
<li id="1.1.1"><strong>1.1.1</strong> Mean-spirited content is not allowed.</li>
<li data-nr data-sidenav="5.1.1" id="data-collection-and-storage">
  <span id="5.1.1"></span><strong>5.1.1<span class="custom-tooltip-icon"><img src="x.svg" /></span> Data Collection and Storage</strong>
  <ul class="no-bullet">
    <li><strong>(i) Privacy Policies: </strong>Must link a policy.
      <ul class="disc"><li>Identify what data is collected.</li></ul>
    </li>
  </ul>
</li>
<li id="4.2.7"><strong>4.2.7 Remote Desktop Clients:</strong> Must comply with:
  <ul class="no-bullet"><li>(a) Only connect to owned devices.</li></ul>
</li>
`;

describe("htmlAyristir", () => {
  const kurallar = htmlAyristir(SAHTE_SAYFA);

  it("üst bölümü yakalar", () => {
    assert.equal(kurallar.get("1")?.baslik, "Safety");
  });

  it("düz numaralı maddeyi yakalar", () => {
    assert.match(kurallar.get("1.1.1")!.metin, /Mean-spirited/);
  });

  it("ipucu ikonu başlığı bozmaz, id slug'da olsa da numara span'den okunur", () => {
    const k = kurallar.get("5.1.1")!;
    assert.equal(k.baslik, "Data Collection and Storage");
  });

  it("iç içe <li>'ye sahip madde ilk iç kapanışta kesilmez", () => {
    assert.match(kurallar.get("5.1.1")!.metin, /Identify what data is collected/);
    assert.match(kurallar.get("4.2.7")!.metin, /Only connect to owned devices/);
  });
});
