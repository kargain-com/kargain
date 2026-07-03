import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { routeNeedsMessagingNotificationsProviders } from "../lib/messaging/messaging-notifications-routes.ts";

describe("messaging-notifications-routes", () => {
  it("matches messages and notifications routes", () => {
    assert.equal(routeNeedsMessagingNotificationsProviders("/messages"), true);
    assert.equal(routeNeedsMessagingNotificationsProviders("/messages/abc"), true);
    assert.equal(routeNeedsMessagingNotificationsProviders("/notifications"), true);
  });

  it("does not match marketplace browse", () => {
    assert.equal(routeNeedsMessagingNotificationsProviders("/"), false);
    assert.equal(routeNeedsMessagingNotificationsProviders("/marketplace/1"), false);
    assert.equal(routeNeedsMessagingNotificationsProviders("/verifiers"), false);
  });
});
