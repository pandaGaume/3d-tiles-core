/** Tracks copyright sources for content currently attached to the scene. */
export class AttributionController {
    private readonly entries = new Map<string, readonly string[]>();

    public constructor(private readonly target: HTMLElement) {}

    public attach(contentId: string, copyrights: readonly string[]): void {
        this.entries.set(contentId, copyrights);
        this.render();
    }

    public detach(contentId: string): void {
        this.entries.delete(contentId);
        this.render();
    }

    public clear(): void {
        this.entries.clear();
        this.render();
    }

    private render(): void {
        const counts = new Map<string, number>();
        for (const entries of this.entries.values()) {
            for (const entry of entries) counts.set(entry, (counts.get(entry) ?? 0) + 1);
        }
        const ordered = [...counts.entries()]
            .sort(([left, leftCount], [right, rightCount]) => rightCount - leftCount || left.localeCompare(right))
            .map(([entry]) => entry);
        this.target.textContent = ordered.length > 0 ? ` | ${ordered.join("; ")}` : "";
    }
}
