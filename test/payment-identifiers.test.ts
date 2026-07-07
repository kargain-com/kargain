import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  detectPaymentIdentifiers,
  LIGHTNING_ADVISORY_USD_1E8,
  paymentIdentifierUri,
} from "../lib/lightning/payment-identifiers.ts";

const INVOICE_2M_MSAT =
  "lnbc20u1p3y0x3hpp5743k2g0fsqqxj7n8qzuhns5gmkk4djeejk3wkp64ppevgekvc0jsdqcve5kzar2v9nr5gpqd4hkuetesp5ez2g297jduwc20t6lmqlsg3man0vf2jfd8ar9fh8fhn2g8yttfkqxqy9gcqcqzys9qrsgqrzjqtx3k77yrrav9hye7zar2rtqlfkytl094dsp0ms5majzth6gt7ca6uhdkxl983uywgqqqqlgqqqvx5qqjqrzjqd98kxkpyw0l9tyy8r8q57k7zpy9zjmh6sez752wj6gcumqnj3yxzhdsmg6qq56utgqqqqqqqqqqqeqqjq7jd56882gtxhrjm03c93aacyfy306m4fq0tskf83c0nmet8zc2lxyyg3saz8x6vwcp26xnrlagf9semau3qm2glysp7sv95693fphvsp54l567";

const BOLT12_OFFER =
  "lno1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";

const BTC_BECH32 = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const BTC_LEGACY = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";
const LUD16 = "pay@example.com";

describe("LIGHTNING_ADVISORY_USD_1E8", () => {
  it("is $1000 at 1e8 scale", () => {
    assert.equal(LIGHTNING_ADVISORY_USD_1E8, 100_000_000_000n);
  });
});

describe("detectPaymentIdentifiers", () => {
  it("detects bolt12 plain and lightning-prefixed", () => {
    assert.deepEqual(detectPaymentIdentifiers(BOLT12_OFFER), [
      { kind: "bolt12", value: BOLT12_OFFER },
    ]);
    assert.deepEqual(detectPaymentIdentifiers(`lightning:${BOLT12_OFFER}`), [
      { kind: "bolt12", value: BOLT12_OFFER },
    ]);
  });

  it("detects bolt11 plain and lightning-prefixed", () => {
    assert.deepEqual(detectPaymentIdentifiers(INVOICE_2M_MSAT), [
      { kind: "bolt11", value: INVOICE_2M_MSAT },
    ]);
    assert.deepEqual(detectPaymentIdentifiers(`lightning:${INVOICE_2M_MSAT}`), [
      { kind: "bolt11", value: INVOICE_2M_MSAT },
    ]);
  });

  it("detects lud16", () => {
    assert.deepEqual(detectPaymentIdentifiers(LUD16), [
      { kind: "lud16", value: "pay@example.com" },
    ]);
    assert.deepEqual(detectPaymentIdentifiers(`lightning:${LUD16}`), [
      { kind: "lud16", value: "pay@example.com" },
    ]);
  });

  it("detects btc-address plain, btc:, and bitcoin: BIP21", () => {
    assert.deepEqual(detectPaymentIdentifiers(BTC_BECH32), [
      { kind: "btc-address", value: BTC_BECH32 },
    ]);
    assert.deepEqual(detectPaymentIdentifiers(`btc:${BTC_BECH32}`), [
      { kind: "btc-address", value: BTC_BECH32 },
    ]);
    assert.deepEqual(
      detectPaymentIdentifiers(`bitcoin:${BTC_BECH32}?amount=0.01`),
      [{ kind: "btc-address", value: BTC_BECH32 }],
    );
    assert.deepEqual(detectPaymentIdentifiers(BTC_LEGACY), [
      { kind: "btc-address", value: BTC_LEGACY },
    ]);
  });

  it("preserves order in mixed note", () => {
    const note = `IBAN DE89 3704 0044 0532 0130 00 pay via ${BTC_BECH32} or ${LUD16}`;
    assert.deepEqual(detectPaymentIdentifiers(note), [
      { kind: "btc-address", value: BTC_BECH32 },
      { kind: "lud16", value: "pay@example.com" },
    ]);
  });

  it("dedupes same address twice", () => {
    const note = `${BTC_BECH32} ${BTC_BECH32}`;
    assert.equal(detectPaymentIdentifiers(note).length, 1);
  });

  it("rejects testnet forms", () => {
    assert.deepEqual(detectPaymentIdentifiers("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx"), []);
    assert.deepEqual(
      detectPaymentIdentifiers(
        "lntb1p3y0x3hpp5743k2g0fsqqxj7n8qzuhns5gmkk4djeejk3wkp64ppevgekvc0jsdqcve5kzar2v9nr5gpqd4hkuetesp5ez2g297jduwc20t6lmqlsg3man0vf2jfd8ar9fh8fhn2g8yttfkqxqy9gcqcqzys9qrsgqrzjqtx3k77yrrav9hye7zar2rtqlfkytl094dsp0ms5majzth6gt7ca6uhdkxl983uywgqqqqlgqqqvx5qqjqrzjqd98kxkpyw0l9tyy8r8q57k7zpy9zjmh6sez752wj6gcumqnj3yxzhdsmg6qq56utgqqqqqqqqqqqeqqjq7jd56882gtxhrjm03c93aacyfy306m4fq0tskf83c0nmet8zc2lxyyg3saz8x6vwcp26xnrlagf9semau3qm2glysp7sv95693fphvsp54l567",
      ),
      [],
    );
    assert.deepEqual(
      detectPaymentIdentifiers(
        "lnbcrt1p3y0x3hpp5743k2g0fsqqxj7n8qzuhns5gmkk4djeejk3wkp64ppevgekvc0jsdqcve5kzar2v9nr5gpqd4hkuetesp5ez2g297jduwc20t6lmqlsg3man0vf2jfd8ar9fh8fhn2g8yttfkqxqy9gcqcqzys9qrsgqrzjqtx3k77yrrav9hye7zar2rtqlfkytl094dsp0ms5majzth6gt7ca6uhdkxl983uywgqqqqlgqqqvx5qqjqrzjqd98kxkpyw0l9tyy8r8q57k7zpy9zjmh6sez752wj6gcumqnj3yxzhdsmg6qq56utgqqqqqqqqqqqeqqjq7jd56882gtxhrjm03c93aacyfy306m4fq0tskf83c0nmet8zc2lxyyg3saz8x6vwcp26xnrlagf9semau3qm2glysp7sv95693fphvsp54l567",
      ),
      [],
    );
  });

  it("rejects mixed-case bech32", () => {
    assert.deepEqual(detectPaymentIdentifiers("bc1Qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"), []);
  });

  it("rejects bolt11 that matches regex but fails decode", () => {
    const garbage =
      "lnbc1p3y0x3hpp5743k2g0fsqqxj7n8qzuhns5gmkk4djeejk3wkp64ppevgekvc0jsdqcve5kzar2v9nr5gpqd4hkuetesp5ez2g297jduwc20t6lmqlsg3man0vf2jfd8ar9fh8fhn2g8yttfkqxqy9gcqcqzys9qrsgqrzjqtx3k77yrrav9hye7zar2rtqlfkytl094dsp0ms5majzth6gt7ca6uhdkxl983uywgqqqqlgqqqvx5qqjqrzjqd98kxkpyw0l9tyy8r8q57k7zpy9zjmh6sez752wj6gcumqnj3yxzhdsmg6qq56utgqqqqqqqqqqqeqqjq7jd56882gtxhrjm03c93aacyfy306m4fq0tskf83c0nmet8zc2lxyyg3saz8x6vwcp26xnrlagf9semau3qm2glysp7sv95693fphvsp54l567";
    assert.deepEqual(detectPaymentIdentifiers(garbage), []);
  });

  it("drops 7th identifier and ignores tail beyond 4000 chars", () => {
    const ids = [
      BTC_BECH32,
      LUD16,
      BTC_LEGACY,
      BOLT12_OFFER,
      INVOICE_2M_MSAT,
      "bc1p0xlxvl45rp9wmck6c3vj9ky2t3v5xqpk2j0tmq7fyl7fwqxv4u9",
      "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
    ];
    const padding = "x".repeat(5_000);
    const note = `${ids.join(" ")} ${padding}`;
    const found = detectPaymentIdentifiers(note);
    assert.equal(found.length, 6);
    assert.equal(found[5]?.kind, "btc-address");
    assert.equal(found[5]?.value, "bc1p0xlxvl45rp9wmck6c3vj9ky2t3v5xqpk2j0tmq7fyl7fwqxv4u9");
  });
});

describe("paymentIdentifierUri", () => {
  it("uses lightning scheme for lightning kinds", () => {
    assert.equal(paymentIdentifierUri({ kind: "bolt12", value: BOLT12_OFFER }), `lightning:${BOLT12_OFFER}`);
    assert.equal(
      paymentIdentifierUri({ kind: "bolt11", value: INVOICE_2M_MSAT }),
      `lightning:${INVOICE_2M_MSAT}`,
    );
    assert.equal(paymentIdentifierUri({ kind: "lud16", value: LUD16 }), `lightning:${LUD16}`);
  });

  it("uses bitcoin scheme for on-chain address", () => {
    assert.equal(
      paymentIdentifierUri({ kind: "btc-address", value: BTC_BECH32 }),
      `bitcoin:${BTC_BECH32}`,
    );
  });
});
