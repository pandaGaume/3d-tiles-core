import type { IMetadataSnapshot } from "../metadata/types";
import type { IRuntimeImplicitSubtree } from "../implicit/types";
import type { IRuntimeContent, IRuntimeFrameResult, IRuntimeTile, IRuntimeTilesetDocument } from "./contracts";
import type { IRuntimeCacheEviction } from "./cache";

export type RuntimeEvent<TSpatial, TContentHandle, TGlyphHandle> =
    | { type: "tileset-ready"; document: IRuntimeTilesetDocument }
    | { type: "frame"; result: IRuntimeFrameResult<TSpatial, TContentHandle, TGlyphHandle> }
    | { type: "tile-selected"; tile: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle> }
    | { type: "tile-deselected"; tile: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle> }
    | {
          type: "content-state";
          tile: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>;
          content: IRuntimeContent<TContentHandle>;
      }
    | { type: "subtree-state"; tile: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>; subtree: IRuntimeImplicitSubtree }
    | { type: "metadata-resolved"; tile: IRuntimeTile<TSpatial, TContentHandle, TGlyphHandle>; snapshot: IMetadataSnapshot }
    | { type: "cache-eviction"; eviction: IRuntimeCacheEviction }
    | { type: "error"; phase: string; error: unknown; tileId?: string; contentId?: string };

export type RuntimeEventListener<TSpatial, TContentHandle, TGlyphHandle> = (
    event: RuntimeEvent<TSpatial, TContentHandle, TGlyphHandle>,
) => void;

export class RuntimeEventHub<TSpatial, TContentHandle, TGlyphHandle> {
    private readonly listeners = new Set<RuntimeEventListener<TSpatial, TContentHandle, TGlyphHandle>>();

    public subscribe(listener: RuntimeEventListener<TSpatial, TContentHandle, TGlyphHandle>): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    public emit(event: RuntimeEvent<TSpatial, TContentHandle, TGlyphHandle>): void {
        for (const listener of this.listeners) listener(event);
    }

    public clear(): void {
        this.listeners.clear();
    }
}
