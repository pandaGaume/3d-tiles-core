# Tiles

`@spacexr/tiles` lives in [spacexr-tiling](../../spacexr-tiling/README.md): tile addressing and topology, the Web Mercator and cube schemes, reference surfaces, pyramids, HTTP sources and source reprojection. See [its architecture decision](../../spacexr-tiling/docs/architecture.md).

The runtime reads its generic addressing and topology only, for the quadtree balance. It owns selection and streaming of the implicit tilesets that a source presents.
