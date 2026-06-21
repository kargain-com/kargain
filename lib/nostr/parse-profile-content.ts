export type NostrProfileData = {
  name?: string;
  about?: string;
  picture?: string;
  website?: string;
};

export function parseProfileContent(content: string): NostrProfileData | null {
  if (!content.trim()) return {};
  try {
    const raw: unknown = JSON.parse(content);
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
    const obj = raw as Record<string, unknown>;
    const result: NostrProfileData = {};
    if (typeof obj.name === "string") result.name = obj.name;
    if (typeof obj.about === "string") result.about = obj.about;
    if (typeof obj.picture === "string") result.picture = obj.picture;
    if (typeof obj.website === "string") result.website = obj.website;
    return result;
  } catch {
    return {};
  }
}
