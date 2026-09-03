import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  hasInjectedEthereumProvider,
  isMobileBrowser,
  walletConnectProjectId,
} from "../lib/web3/wallet-connect.ts";

function withGlobalProperty<T>(
  key: "window" | "navigator",
  value: T | undefined,
  run: () => void,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
  if (value === undefined) {
    delete globalThis[key];
  } else {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }

  try {
    run();
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      delete globalThis[key];
    }
  }
}

describe("walletConnectProjectId", () => {
  const originalEnv = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
    } else {
      process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID = originalEnv;
    }
  });

  it("returns trimmed project id when set", () => {
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID = "  abc123  ";
    assert.equal(walletConnectProjectId(), "abc123");
  });

  it("returns undefined when unset or blank", () => {
    delete process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
    assert.equal(walletConnectProjectId(), undefined);

    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID = "   ";
    assert.equal(walletConnectProjectId(), undefined);
  });
});

describe("hasInjectedEthereumProvider", () => {
  it("is false without window", () => {
    withGlobalProperty("window", undefined, () => {
      assert.equal(hasInjectedEthereumProvider(), false);
    });
  });

  it("is false when window.ethereum is missing", () => {
    withGlobalProperty("window", {} as Window & typeof globalThis, () => {
      assert.equal(hasInjectedEthereumProvider(), false);
    });
  });

  it("is true when window.ethereum exists", () => {
    withGlobalProperty("window", { ethereum: {} } as Window & typeof globalThis, () => {
      assert.equal(hasInjectedEthereumProvider(), true);
    });
  });
});

describe("isMobileBrowser", () => {
  it("is false without navigator", () => {
    withGlobalProperty("navigator", undefined, () => {
      assert.equal(isMobileBrowser(), false);
    });
  });

  it("detects iPhone user agent", () => {
    withGlobalProperty(
      "navigator",
      { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" } as Navigator,
      () => {
        assert.equal(isMobileBrowser(), true);
      },
    );
  });

  it("detects Android user agent", () => {
    withGlobalProperty(
      "navigator",
      { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)" } as Navigator,
      () => {
        assert.equal(isMobileBrowser(), true);
      },
    );
  });

  it("is false for desktop user agent", () => {
    withGlobalProperty(
      "navigator",
      { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" } as Navigator,
      () => {
        assert.equal(isMobileBrowser(), false);
      },
    );
  });
});
