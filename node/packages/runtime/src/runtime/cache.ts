export interface IRuntimeResourceCost {
    cpuBytes?: number;
    gpuBytes?: number;
    networkBytes?: number;
}

export interface IRuntimeCacheOptions {
    enabled?: boolean;
    maxMaterializedTiles?: number;
    maxContentEntries?: number;
    /**
     * Makes the budgets of entries and tiles adaptive: they grow to this many times what the current view uses, the
     * selected tiles for `maxContentEntries` and the tiles visited by the traversal for `maxMaterializedTiles`, and come
     * back as the view needs less. Budgets close to the view make a moving camera evict and load the same tiles again and
     * again. Byte budgets stay fixed: they bound the memory. Defaults to 0, fixed budgets.
     */
    workingSetFactor?: number;
    maxContentCpuBytes?: number;
    maxContentGpuBytes?: number;
    maxSubtreeEntries?: number;
    maxSubtreeBytes?: number;
    /**
     * Time an inactive resource stays cached, in milliseconds: a renderable, a subtree payload or a materialized
     * implicit branch unused for longer is evicted at the next frame. Defaults to 60 000.
     */
    unusedRetentionMilliseconds?: number;
    /**
     * Number of runtime frames an inactive resource stays cached, in place of `unusedRetentionMilliseconds`.
     *
     * @deprecated Runtime frames only run while the camera moves or loads settle, so a frame count is a short time
     * while the camera turns and an endless one while it rests. Use `unusedRetentionMilliseconds`.
     */
    unusedFrameRetention?: number;
}

export interface IResolvedRuntimeCacheOptions {
    enabled: boolean;
    maxMaterializedTiles: number;
    maxContentEntries: number;
    workingSetFactor: number;
    maxContentCpuBytes: number;
    maxContentGpuBytes: number;
    maxSubtreeEntries: number;
    maxSubtreeBytes: number;
    unusedRetentionMilliseconds: number;
    /** Deprecated frame count, applied instead of the time when an application sets it. */
    unusedFrameRetention?: number;
}

export type RuntimeCacheResourceKind = "content" | "subtree" | "implicit-branch";

export type RuntimeCacheEvictionReason = "stale" | "entry-budget" | "cpu-budget" | "gpu-budget" | "byte-budget" | "node-budget";

export interface IRuntimeCacheEviction {
    kind: RuntimeCacheResourceKind;
    reason: RuntimeCacheEvictionReason;
    tileId: string;
    resourceId?: string;
    releasedCpuBytes: number;
    releasedGpuBytes: number;
    releasedEntries: number;
}

export interface IRuntimeCacheCounters {
    sweeps: number;
    contentEvictions: number;
    subtreeEvictions: number;
    implicitBranchPrunes: number;
    prunedNodes: number;
    releasedCpuBytes: number;
    releasedGpuBytes: number;
}

export const DEFAULT_RUNTIME_CACHE_OPTIONS: IResolvedRuntimeCacheOptions = {
    enabled: true,
    maxMaterializedTiles: 4096,
    // The byte budgets bound the memory; entries only bound the bookkeeping of many small contents.
    maxContentEntries: 4096,
    workingSetFactor: 0,
    maxContentCpuBytes: 512 * 1024 * 1024,
    maxContentGpuBytes: 1024 * 1024 * 1024,
    maxSubtreeEntries: 128,
    maxSubtreeBytes: 64 * 1024 * 1024,
    unusedRetentionMilliseconds: 60_000,
};

function resolveBudget(value: number | undefined, fallback: number): number {
    if (value === undefined) return fallback;
    if (!Number.isFinite(value)) return value > 0 ? Number.POSITIVE_INFINITY : 0;
    return Math.max(0, Math.floor(value));
}

export function resolveRuntimeCacheOptions(options: IRuntimeCacheOptions | false | undefined): IResolvedRuntimeCacheOptions {
    if (options === false) return { ...DEFAULT_RUNTIME_CACHE_OPTIONS, enabled: false };
    return {
        enabled: options?.enabled ?? DEFAULT_RUNTIME_CACHE_OPTIONS.enabled,
        maxMaterializedTiles: resolveBudget(options?.maxMaterializedTiles, DEFAULT_RUNTIME_CACHE_OPTIONS.maxMaterializedTiles),
        maxContentEntries: resolveBudget(options?.maxContentEntries, DEFAULT_RUNTIME_CACHE_OPTIONS.maxContentEntries),
        workingSetFactor: resolveBudget(options?.workingSetFactor, DEFAULT_RUNTIME_CACHE_OPTIONS.workingSetFactor),
        maxContentCpuBytes: resolveBudget(options?.maxContentCpuBytes, DEFAULT_RUNTIME_CACHE_OPTIONS.maxContentCpuBytes),
        maxContentGpuBytes: resolveBudget(options?.maxContentGpuBytes, DEFAULT_RUNTIME_CACHE_OPTIONS.maxContentGpuBytes),
        maxSubtreeEntries: resolveBudget(options?.maxSubtreeEntries, DEFAULT_RUNTIME_CACHE_OPTIONS.maxSubtreeEntries),
        maxSubtreeBytes: resolveBudget(options?.maxSubtreeBytes, DEFAULT_RUNTIME_CACHE_OPTIONS.maxSubtreeBytes),
        unusedRetentionMilliseconds: resolveBudget(
            options?.unusedRetentionMilliseconds,
            DEFAULT_RUNTIME_CACHE_OPTIONS.unusedRetentionMilliseconds,
        ),
        ...(options?.unusedFrameRetention === undefined
            ? {}
            : { unusedFrameRetention: resolveBudget(options.unusedFrameRetention, Number.POSITIVE_INFINITY) }),
    };
}
