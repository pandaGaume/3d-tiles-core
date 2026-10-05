import type { IMetadataSnapshot } from "../metadata/types";
import type { ITileContext } from "../runtime/contracts";

export interface IGlyphPublicationContext<TSpatial, TContentHandle> extends ITileContext<TSpatial> {
    metadata: readonly IMetadataSnapshot[];
    contentHandles: readonly TContentHandle[];
}

/** Publishes labels, anchors, symbols or domain-specific glyphs. */
export interface IGlyphPublisher<TSpatial, TContentHandle, TGlyphHandle> {
    publish(context: IGlyphPublicationContext<TSpatial, TContentHandle>): readonly TGlyphHandle[] | Promise<readonly TGlyphHandle[]>;
    revoke(handles: readonly TGlyphHandle[], context: IGlyphPublicationContext<TSpatial, TContentHandle>): void | Promise<void>;
}
