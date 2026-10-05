export interface IRuntimeResourceCost {
    cpuBytes?: number;
    gpuBytes?: number;
    networkBytes?: number;
}

export interface IRuntimeCacheOptions {
    enabled?: boolean;
    maxMaterializedTiles?: number;
    maxContentEntries?: number;
    maxContentCpuBytes?: number;
    maxContentGpuBytes?: number;
    maxSubtreeEntries?: number;
    maxSubtreeBytes?: number;
    unusedFrameRetention?: number;
}

export interface IResolvedRuntimeCacheOptions {
    enabled: boolean;
    maxMaterializedTiles: number;
    maxContentEntries: number;
    maxContentCpuBytes: number;
    maxContentGpuBytes: number;
    maxSubtreeEntries: number;
    maxSubtreeBytes: number;
    unusedFrameRetention: number;
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
    maxContentEntries: 512,
    maxContentCpuBytes: 512 * 1024 * 1024,
    maxContentGpuBytes: 1024 * 1024 * 1024,
    maxSubtreeEntries: 128,
    maxSubtreeBytes: 64 * 1024 * 1024,
    unusedFrameRetention: 120,
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
        maxContentCpuBytes: resolveBudget(options?.maxContentCpuBytes, DEFAULT_RUNTIME_CACHE_OPTIONS.maxContentCpuBytes),
        maxContentGpuBytes: resolveBudget(options?.maxContentGpuBytes, DEFAULT_RUNTIME_CACHE_OPTIONS.maxContentGpuBytes),
        maxSubtreeEntries: resolveBudget(options?.maxSubtreeEntries, DEFAULT_RUNTIME_CACHE_OPTIONS.maxSubtreeEntries),
        maxSubtreeBytes: resolveBudget(options?.maxSubtreeBytes, DEFAULT_RUNTIME_CACHE_OPTIONS.maxSubtreeBytes),
        unusedFrameRetention: resolveBudget(options?.unusedFrameRetention, DEFAULT_RUNTIME_CACHE_OPTIONS.unusedFrameRetention),
    };
}
