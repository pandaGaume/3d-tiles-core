import type { RootProperty } from "./common";

export type SubdivisionScheme = "QUADTREE" | "OCTREE";

export interface SubtreeReference extends RootProperty {
    uri: string;
}

export interface ImplicitTiling extends RootProperty {
    subdivisionScheme: SubdivisionScheme;
    subtreeLevels: number;
    availableLevels: number;
    subtrees: SubtreeReference;
}
