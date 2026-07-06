import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseLud16, lud16WellKnownUrl } from "../lib/lightning/lud16.ts";
import {
  parsePayParams,
  parseVerifyResponse,
  verifyInvoiceAmount,
  validateCallbackUrl,
} from "../lib/lightning/lnurl.ts";

// Fixture from light-bolt11-decoder README — 20u = 2_000_000 msat
const INVOICE_2M_MSAT =
  "lnbc20u1p3y0x3hpp5743k2g0fsqqxj7n8qzuhns5gmkk4djeejk3wkp64ppevgekvc0jsdqcve5kzar2v9nr5gpqd4hkuetesp5ez2g297jduwc20t6lmqlsg3man0vf2jfd8ar9fh8fhn2g8yttfkqxqy9gcqcqzys9qrsgqrzjqtx3k77yrrav9hye7zar2rtqlfkytl094dsp0ms5majzth6gt7ca6uhdkxl983uywgqqqqlgqqqvx5qqjqrzjqd98kxkpyw0l9tyy8r8q57k7zpy9zjmh6sez752wj6gcumqnj3yxzhdsmg6qq56utgqqqqqqqqqqqeqqjq7jd56882gtxhrjm03c93aacyfy306m4fq0tskf83c0nmet8zc2lxyyg3saz8x6vwcp26xnrlagf9semau3qm2glysp7sv95693fphvsp54l567";

describe("parseLud16", () => {
  it("parses valid address", () => {
    assert.deepEqual(parseLud16("Pay@Example.com"), {
      name: "pay",
      domain: "example.com",
    });
  });

  it("rejects missing @", () => {
    assert.equal(parseLud16("payexample.com"), null);
  });

  it("rejects localhost domain", () => {
    assert.equal(parseLud16("pay@localhost"), null);
  });
});

describe("lud16WellKnownUrl", () => {
  it("builds HTTPS well-known path", () => {
    assert.equal(
      lud16WellKnownUrl("pay", "example.com"),
      "https://example.com/.well-known/lnurlp/pay",
    );
  });
});

describe("parsePayParams", () => {
  it("parses payRequest", () => {
    const params = parsePayParams({
      tag: "payRequest",
      callback: "https://provider.example.com/invoice",
      minSendable: 1000,
      maxSendable: 1_000_000_000,
      commentAllowed: 80,
    });
    assert.deepEqual(params, {
      tag: "payRequest",
      callback: "https://provider.example.com/invoice",
      minSendable: 1000,
      maxSendable: 1_000_000_000,
      commentAllowed: 80,
    });
  });

  it("rejects invalid tag", () => {
    assert.equal(parsePayParams({ tag: "withdrawRequest" }), null);
  });
});

describe("validateCallbackUrl", () => {
  it("accepts HTTPS on public hostname", () => {
    assert.equal(
      validateCallbackUrl("https://provider.example.com/callback"),
      true,
    );
  });

  it("rejects HTTP", () => {
    assert.equal(validateCallbackUrl("http://provider.example.com/cb"), false);
  });

  it("rejects IP literals", () => {
    assert.equal(validateCallbackUrl("https://127.0.0.1/cb"), false);
  });
});

describe("verifyInvoiceAmount", () => {
  it("matches fixture invoice msat", () => {
    assert.equal(verifyInvoiceAmount(INVOICE_2M_MSAT, 2_000_000n), true);
  });

  it("rejects amount mismatch", () => {
    assert.equal(verifyInvoiceAmount(INVOICE_2M_MSAT, 1_000_000n), false);
  });
});

describe("parseVerifyResponse", () => {
  it("parses settled true", () => {
    assert.deepEqual(parseVerifyResponse({ status: "OK", settled: true }), {
      settled: true,
    });
  });

  it("rejects non-OK status", () => {
    assert.equal(parseVerifyResponse({ status: "ERROR" }), null);
  });
});
