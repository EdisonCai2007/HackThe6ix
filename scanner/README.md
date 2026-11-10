# LEGO scanner

The scanning side of the project: capture a pile of LEGO with a LiDAR iPhone and turn it into a parts inventory that the build generator in the root of this repository can use.

- [`capture/`](capture/) — records synchronized RGB, depth and pose from the iPhone (Record3D), tracks scan coverage, exports a top-down image of the workspace, and runs the end-to-end scan → analysis → confirmation demo. Includes a vendored copy of the confirmation pipeline in `capture/cv_pipeline/`.
- [`vision/`](vision/) — piece detection and identification, segmentation-model training, and the inventory review tools.

Each directory keeps its own README, tests and commit history.
