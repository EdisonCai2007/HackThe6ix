import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

test("catalogue thumbnails reuse one WebGL renderer", async () => {
  const thumbnailModule = await import(
    "../../src/preview/catalogueThumbnailRenderer.js"
  ).catch(() => null);

  assert.ok(thumbnailModule, "shared catalogue thumbnail renderer module is required");

  let rendererCreations = 0;
  let renderCalls = 0;
  const fakeRenderer = {
    domElement: { nodeName: "CANVAS" },
    setPixelRatio() {},
    setSize() {},
    render() {
      renderCalls += 1;
    },
  };
  const fakeLoader = {
    parse(ldrawText, onLoad) {
      assert.match(ldrawText, /Catalogue thumbnail/);
      const group = new THREE.Group();
      group.add(
        new THREE.Mesh(
          new THREE.BoxGeometry(20, 24, 20),
          new THREE.MeshBasicMaterial(),
        ),
      );
      onLoad(group);
    },
  };
  const drawCounts = [0, 0];
  const canvases = drawCounts.map((_, index) => ({
    clientWidth: 120,
    clientHeight: 80,
    width: 0,
    height: 0,
    getContext(type) {
      assert.equal(type, "2d");
      return {
        clearRect() {},
        drawImage() {
          drawCounts[index] += 1;
        },
      };
    },
  }));
  const item = {
    part_id: "3005",
    ldraw_id: "3005.dat",
    label: "1x1 brick",
    color_id: "14",
    color_name: "yellow",
    category: "brick",
  };
  const thumbnailRenderer = thumbnailModule.createCatalogueThumbnailRenderer({
    createRenderer() {
      rendererCreations += 1;
      return fakeRenderer;
    },
    createLoader: () => fakeLoader,
    pixelRatio: () => 1,
  });

  await thumbnailRenderer.render(canvases[0], item);
  await thumbnailRenderer.render(canvases[1], item);

  assert.equal(rendererCreations, 1);
  assert.equal(renderCalls, 2);
  assert.deepEqual(drawCounts, [1, 1]);
});
