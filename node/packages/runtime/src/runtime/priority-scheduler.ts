interface IScheduledTask {
    key: string;
    priority: number;
    order: number;
    run: (signal: AbortSignal) => Promise<void>;
    controller: AbortController;
}

export class PriorityScheduler {
    private readonly concurrency: number;
    private readonly queued = new Map<string, IScheduledTask>();
    private readonly running = new Map<string, IScheduledTask>();
    private readonly idleWaiters = new Set<() => void>();
    private order = 0;
    private disposed = false;

    public constructor(concurrency: number) {
        this.concurrency = Math.max(1, Math.floor(concurrency));
    }

    public get size(): number {
        return this.queued.size + this.running.size;
    }

    public enqueue(key: string, priority: number, run: (signal: AbortSignal) => Promise<void>): boolean {
        if (this.disposed || this.running.has(key)) return false;
        const existing = this.queued.get(key);
        if (existing) {
            existing.priority = Math.max(existing.priority, priority);
            return false;
        }
        this.queued.set(key, { key, priority, order: this.order++, run, controller: new AbortController() });
        this.pump();
        return true;
    }

    public cancel(key: string): void {
        const queued = this.queued.get(key);
        if (queued) {
            queued.controller.abort();
            this.queued.delete(key);
            this.notifyIdle();
        }
        this.running.get(key)?.controller.abort();
    }

    public whenIdle(): Promise<void> {
        if (this.size === 0) return Promise.resolve();
        return new Promise((resolve) => this.idleWaiters.add(resolve));
    }

    public dispose(): void {
        this.disposed = true;
        for (const task of this.queued.values()) task.controller.abort();
        for (const task of this.running.values()) task.controller.abort();
        this.queued.clear();
        this.notifyIdle();
    }

    private pump(): void {
        while (!this.disposed && this.running.size < this.concurrency && this.queued.size > 0) {
            const next = [...this.queued.values()].sort((left, right) => right.priority - left.priority || left.order - right.order)[0];
            if (!next) return;
            this.queued.delete(next.key);
            this.running.set(next.key, next);
            void next
                .run(next.controller.signal)
                .catch(() => undefined)
                .finally(() => {
                    this.running.delete(next.key);
                    this.pump();
                    this.notifyIdle();
                });
        }
    }

    private notifyIdle(): void {
        if (this.size !== 0) return;
        for (const resolve of this.idleWaiters) resolve();
        this.idleWaiters.clear();
    }
}
