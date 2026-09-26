import type { IRootProperty } from "./common";

export type SubdivisionScheme = "QUADTREE" | "OCTREE";

export interface ISubtreeReference extends IRootProperty {
    uri: string;
}

export interface IImplicitTiling extends IRootProperty {
    subdivisionScheme: SubdivisionScheme;
    subtreeLevels: number;
    availableLevels: number;
    subtrees: ISubtreeReference;
}
