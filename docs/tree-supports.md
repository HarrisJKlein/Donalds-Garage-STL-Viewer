# Browser tree-support estimate

The viewer's estimator was independently implemented after studying the open-source FFF organic-support generator in **PrusaSlicer 2.9.4**, commit `69c8e569410efe82259e706cd09a05ea82da9359`. No PrusaSlicer source code is bundled or translated verbatim. The implementation and source remain available in this repository under its MIT license.

Upstream PrusaSlicer is AGPL-3.0-or-later. Its source credits Prusa Research, Thomas Rahm's tree-support implementation and CuraEngine/UltiMaker. References:

- [TreeSupport.cpp](https://github.com/prusa3d/PrusaSlicer/blob/69c8e569410efe82259e706cd09a05ea82da9359/src/libslic3r/Support/TreeSupport.cpp): `generate_support_areas`, `generate_overhangs`, `generate_initial_areas`, `create_layer_pathing`, `create_nodes_from_area`.
- [TreeModelVolumes.cpp](https://github.com/prusa3d/PrusaSlicer/blob/69c8e569410efe82259e706cd09a05ea82da9359/src/libslic3r/Support/TreeModelVolumes.cpp): collision, avoidance and build-plate reachability fields.
- [TreeSupportCommon.cpp](https://github.com/prusa3d/PrusaSlicer/blob/69c8e569410efe82259e706cd09a05ea82da9359/src/libslic3r/Support/TreeSupportCommon.cpp): branch movement bounded by `tan(branch_angle) * layer_height`, tip/branch radii, model clearances.
- [OrganicSupport.cpp](https://github.com/prusa3d/PrusaSlicer/blob/69c8e569410efe82259e706cd09a05ea82da9359/src/libslic3r/Support/OrganicSupport.cpp): collision-constrained branch smoothing and tube generation.

## Algorithm used here

1. Restore the model's millimeter scale and the orientation used for each printer's fit preview. Rasterize vertical triangle intersections into solid columns.
2. Identify unsupported lower surfaces using a coarse 45° overhang criterion. Sample up to 80 contact tips with a 0.25 mm contact gap.
3. Build a collision field and propagate a reachable region upward from the bed. A branch may move sideways by at most `tan(40°) * vertical_step`.
4. Starting at contacts, grow branches downward through reachable free cells. Merge nodes whose permitted positions overlap, and increase the branch radius toward the bed. Limit the preview radius to 3.5 mm.
5. Discard any tree that cannot reach the bed. Smooth connected paths while checking the angle limit and collision grid, then render tapered branch segments in purple.

## Limits

This is a **coarse geometric estimate, not PrusaSlicer output or a printer profile**. PrusaSlicer uses actual sliced polygon layers, richer influence-area operations and avoidance volumes, roof/interface generation, configurable printer/material settings, and extrusion toolpaths. This viewer uses a bounded raster grid and coarser height steps to run locally in a Web Worker. Fine features, bridges, thin walls and cavities may be missed. Open meshes or excessive raster workloads are reported rather than presented as successful estimates.

Only build-plate-rooted supports are estimated. Unreachable contacts are reported. The estimate does not change the model-only fit result and does not guarantee support clearance or printability. It is not a slicing service and produces no G-code. Use the target printer's slicer profile to generate actual supports and validate the final job.
