/**
 * Policy: KarPassportBridgeGateway registration ↔ ONFT handlers (bidirectional).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PONDER_CONFIG = path.join(ROOT, "ponder.config.ts");
const BRIDGE_HANDLERS = path.join(ROOT, "src/bridge-handlers.ts");

const GATEWAY_CONTRACT = "KarPassportBridgeGateway";
const REQUIRED_EVENTS = ["ONFTSent", "ONFTReceived"] as const;

function listGatewayHandlers(source: string): string[] {
  const re =
    /(?:ponder\.on|onOptionalContractEvent)\(\s*"KarPassportBridgeGateway:([^"]+)"/g;
  const events: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    events.push(match[1]);
  }
  return events;
}

function gatewayRegistered(source: string): boolean {
  return (
    source.includes(`${GATEWAY_CONTRACT}:`) &&
    source.includes("KarPassportBridgeGatewayAbi")
  );
}

function assertGatewayPolicy(configSrc: string, handlerSrc: string): void {
  const registered = gatewayRegistered(configSrc);
  const handlerEvents = listGatewayHandlers(handlerSrc);

  if (registered) {
    for (const event of REQUIRED_EVENTS) {
      assert.ok(
        handlerEvents.includes(event),
        `registered ${GATEWAY_CONTRACT} requires handler for ${event}`,
      );
    }
  }

  for (const event of handlerEvents) {
    assert.ok(
      registered,
      `handler KarPassportBridgeGateway:${event} requires registration in ponder.config.ts`,
    );
  }
}

describe("ponder gateway index policy", () => {
  const configSrc = fs.readFileSync(PONDER_CONFIG, "utf8");
  const handlerSrc = fs.readFileSync(BRIDGE_HANDLERS, "utf8");

  it("registration → handler: ONFTSent and ONFTReceived indexed when gateway registered", () => {
    assertGatewayPolicy(configSrc, handlerSrc);
    assert.ok(gatewayRegistered(configSrc), "KarPassportBridgeGateway must be registered");
    assert.deepEqual(listGatewayHandlers(handlerSrc).sort(), [...REQUIRED_EVENTS].sort());
  });

  it("handler → registration: every gateway handler has config registration", () => {
    assertGatewayPolicy(configSrc, handlerSrc);
  });

  it("constructed violation: registration without ONFTReceived handler fails", () => {
    const dirtyHandlers = handlerSrc.replace(
      /onOptionalContractEvent\(\s*"KarPassportBridgeGateway:ONFTReceived"/,
      'onOptionalContractEvent("KarPassportBridgeGateway:ONFTReceived_REMOVED"',
    );
    assert.throws(
      () => assertGatewayPolicy(configSrc, dirtyHandlers),
      /requires handler for ONFTReceived/,
    );
  });

  it("constructed violation: ONFTSent handler without registration fails", () => {
    const dirtyConfig = configSrc.replace(/KarPassportBridgeGateway/g, "KarPassportBridgeGateway_REMOVED");
    assert.throws(
      () => assertGatewayPolicy(dirtyConfig, handlerSrc),
      /requires registration in ponder.config.ts/,
    );
  });
});
