const PRESENCE_TTL_MS = 75 * 1000;

type TabPresence = {
  userId: number;
  username: string;
  lastSeenAt: number;
};

const tabPresenceById = new Map<string, TabPresence>();

const pruneExpiredPresence = () => {
  const now = Date.now();
  for (const [tabId, presence] of tabPresenceById.entries()) {
    if (now - presence.lastSeenAt > PRESENCE_TTL_MS) {
      tabPresenceById.delete(tabId);
    }
  }
};

export const markPresenceHeartbeat = (userId: number, username: string, tabId: string) => {
  if (!Number.isFinite(userId) || userId <= 0 || !tabId) {
    return;
  }

  pruneExpiredPresence();
  tabPresenceById.set(tabId, {
    userId,
    username,
    lastSeenAt: Date.now()
  });
};

export const markPresenceClosed = (userId: number, tabId: string) => {
  if (!Number.isFinite(userId) || userId <= 0 || !tabId) {
    return;
  }

  const current = tabPresenceById.get(tabId);
  if (current && current.userId === userId) {
    tabPresenceById.delete(tabId);
  }
};

export const getPresenceByUserId = (): Map<number, { activeTabCount: number; lastActiveAt: string | null; isActive: boolean }> => {
  pruneExpiredPresence();

  const summary = new Map<number, { activeTabCount: number; lastActiveAtMs: number }>();
  for (const presence of tabPresenceById.values()) {
    const existing = summary.get(presence.userId);
    if (!existing) {
      summary.set(presence.userId, {
        activeTabCount: 1,
        lastActiveAtMs: presence.lastSeenAt
      });
      continue;
    }

    existing.activeTabCount += 1;
    existing.lastActiveAtMs = Math.max(existing.lastActiveAtMs, presence.lastSeenAt);
  }

  const finalized = new Map<number, { activeTabCount: number; lastActiveAt: string | null; isActive: boolean }>();
  for (const [userId, item] of summary.entries()) {
    finalized.set(userId, {
      activeTabCount: item.activeTabCount,
      lastActiveAt: new Date(item.lastActiveAtMs).toISOString(),
      isActive: item.activeTabCount > 0
    });
  }

  return finalized;
};
