export type RuntimeMetricName =
    | "frame"
    | "frame.duration"
    | "frame.selected"
    | "tileset.load"
    | "subtree.load"
    | "subtree.load.duration"
    | "subtree.load.bytes"
    | "subtree.cache.evict"
    | "content.load"
    | "content.load.duration"
    | "content.load.network-bytes"
    | "content.error"
    | "content.cache.evict"
    | "tile.attach"
    | "tile.detach"
    | "tile.refine"
    | "tile.coarsen"
    | "tile.node.prune"
    | "cache.sweep.duration"
    | "cache.content.entries"
    | "cache.content.cpu-bytes"
    | "cache.content.gpu-bytes"
    | "cache.subtree.entries"
    | "cache.subtree.bytes"
    | "runtime.error"
    | "metadata.diagnostic";

export interface IRuntimeMetric {
    name: RuntimeMetricName;
    value: number;
    unit: "count" | "millisecond" | "pixel" | "byte";
    tags?: Readonly<Record<string, string | number | boolean>>;
}

/** Receives operational metrics without imposing a monitoring product. */
export interface IRuntimeTelemetry {
    record(metric: IRuntimeMetric): void;
}
