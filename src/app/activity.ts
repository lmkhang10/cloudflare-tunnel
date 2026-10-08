export type ActivityType = 'connector-failed' | 'connector-restarted' | 'connector-gave-up' | 'quick-url' | 'update-available' | 'update-installed' | 'update-failed' | 'project-started' | 'service';

export interface ActivityEvent { id: number; type: ActivityType; title: string; message: string; projectId?: string; notify: boolean; at: string; }

/** Bounded in-memory event feed that the tray polls with `after` to raise desktop notifications. */
export class ActivityFeed {
  private readonly items: ActivityEvent[] = [];
  private nextId = 1;
  constructor(private readonly limit = 200) {}

  push(event: Omit<ActivityEvent, 'id' | 'at'>): ActivityEvent {
    const item = { ...event, id: this.nextId++, at: new Date().toISOString() };
    this.items.push(item); if (this.items.length > this.limit) this.items.shift();
    return item;
  }

  list(after = 0): { events: ActivityEvent[]; lastId: number } {
    return { events: this.items.filter(item => item.id > after), lastId: this.nextId - 1 };
  }
}
