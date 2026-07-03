const MESSAGING_NOTIFICATIONS_ROUTE_PREFIXES = ["/messages", "/notifications"] as const;

export function routeNeedsMessagingNotificationsProviders(pathname: string): boolean {
  return MESSAGING_NOTIFICATIONS_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
