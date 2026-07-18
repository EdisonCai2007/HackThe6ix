import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";

import { getPartDimensions } from "../generation/partCatalog.js";
import {
  findDropZForFootprint,
  PLATE_UNIT_LDU,
  positionToLduCenter,
  snapGridPosition,
  STUD_LDU,
} from "./editorGeometry.js";
import {
  brickWithRotationPreservingCenter,
  moveBrick,
  rotateBrickToRotation,
} from "./editorState.js";

function brickIdFromObject(object) {
  let current = object;

  while (current) {
    if (current.userData?.type === "editable-brick") {
      return current.userData.brickId;
    }
    current = current.parent;
  }

  return null;
}

export function lduToGridPosition(position, brick) {
  if (!brick) {
    return null;
  }

  const dimensions = getPartDimensions(brick.part_id, brick.rotation);

  if (!dimensions) {
    return null;
  }

  return {
    x: position.x / STUD_LDU - dimensions.width / 2,
    y: position.z / STUD_LDU - dimensions.depth / 2,
    z: (position.y - dimensions.height * PLATE_UNIT_LDU / 2) / PLATE_UNIT_LDU,
  };
}

export function editorToolAvailability(selectedBrickId) {
  return {
    hand: true,
    axis: true,
    rotate: true,
  };
}

const HAND_DRAG_THRESHOLD_PX = 4;
const ROTATION_RING_MARGIN_LDU = 10;
const ROTATION_RING_TUBE_LDU = 2;
const ROTATION_RING_HIT_TUBE_LDU = 10;
const ROTATION_ANGLE_FILL_OPACITY = 0.26;
const QUARTER_TURN_RADIANS = Math.PI / 2;

function hideCenterHandles(transformControls) {
  const gizmo = transformControls._gizmo;

  for (const group of [
    gizmo?.gizmo?.translate,
    gizmo?.picker?.translate,
    gizmo?.helper?.translate,
  ]) {
    const centerHandle = group?.getObjectByName?.("XYZ");

    if (centerHandle) {
      centerHandle.visible = false;
    }
  }
}

export function configureAxisTransformControls(transformControls) {
  transformControls.showX = true;
  transformControls.showY = true;
  transformControls.showZ = true;
  transformControls.showXY = false;
  transformControls.showYZ = false;
  transformControls.showXZ = false;
  hideCenterHandles(transformControls);

  const gizmo = transformControls._gizmo;

  if (gizmo?.updateMatrixWorld) {
    const updateMatrixWorld = gizmo.updateMatrixWorld.bind(gizmo);
    gizmo.updateMatrixWorld = (...args) => {
      const result = updateMatrixWorld(...args);
      hideCenterHandles(transformControls);
      return result;
    };
  }
}

export function createEditorControls({
  camera,
  domElement,
  scene,
  orbitControls,
  brickScene,
  getModel,
  setModel,
  onSelectionChange,
  onBrickContextMenu,
  createTransformControls = (editorCamera, editorDomElement) =>
    new TransformControls(editorCamera, editorDomElement),
}) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const transformControls = createTransformControls(camera, domElement);
  const transformControlsHelper = typeof transformControls.getHelper === "function"
    ? transformControls.getHelper()
    : transformControls;
  transformControls.setMode("translate");
  configureAxisTransformControls(transformControls);
  scene.add(transformControlsHelper);

  const rotationRing = new THREE.Mesh(
    new THREE.TorusGeometry(1, ROTATION_RING_TUBE_LDU, 8, 96),
    new THREE.MeshBasicMaterial({
      color: 0xf2cd37,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  rotationRing.name = "editor-rotation-ring";
  rotationRing.visible = false;
  rotationRing.renderOrder = 4;
  rotationRing.userData.type = "rotation-ring";
  const rotationRingParent = brickScene.root ?? scene;
  rotationRingParent.add(rotationRing);

  const rotationAngleFill = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color: 0xffa12b,
      transparent: true,
      opacity: ROTATION_ANGLE_FILL_OPACITY,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  rotationAngleFill.name = "editor-rotation-angle-fill";
  rotationAngleFill.visible = false;
  rotationAngleFill.renderOrder = 3;
  rotationAngleFill.raycast = () => {};
  rotationAngleFill.userData.type = "rotation-angle-fill";
  rotationRingParent.add(rotationAngleFill);

  const rotationRingHitTarget = new THREE.Mesh(
    new THREE.TorusGeometry(1, ROTATION_RING_HIT_TUBE_LDU, 8, 96),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  rotationRingHitTarget.name = "editor-rotation-ring-hit-target";
  rotationRingHitTarget.visible = false;
  rotationRingHitTarget.userData.type = "rotation-ring-hit-target";
  rotationRingParent.add(rotationRingHitTarget);

  let tool = "hand";
  let selectedBrickId = null;
  let handDrag = null;
  let rotateDrag = null;
  let axisDragActive = false;
  let axisCommitPending = false;
  let snappingAxisObject = false;

  function updatePointer(event) {
    const rect = domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  }

  function ringRadiusForBrick(brick) {
    const dimensions = getPartDimensions(brick.part_id, brick.rotation);

    if (!dimensions) {
      return null;
    }

    const halfWidth = dimensions.width * STUD_LDU / 2;
    const halfDepth = dimensions.depth * STUD_LDU / 2;
    return Math.hypot(halfWidth, halfDepth) + ROTATION_RING_MARGIN_LDU;
  }

  function updateRotationRingGeometry(radius) {
    if (rotationRing.userData.radius === radius) {
      return;
    }

    rotationRing.geometry.dispose();
    rotationRing.geometry = new THREE.TorusGeometry(
      radius,
      ROTATION_RING_TUBE_LDU,
      8,
      96,
    );
    rotationRing.userData.radius = radius;

    rotationRingHitTarget.geometry.dispose();
    rotationRingHitTarget.geometry = new THREE.TorusGeometry(
      radius,
      ROTATION_RING_HIT_TUBE_LDU,
      8,
      96,
    );
  }

  function syncRotationRingToBrick(brick) {
    if (!brick || tool !== "rotate") {
      rotationRing.visible = false;
      rotationRingHitTarget.visible = false;
      rotationAngleFill.visible = false;
      return;
    }

    const radius = ringRadiusForBrick(brick);
    const dimensions = getPartDimensions(brick.part_id, brick.rotation);

    if (radius === null || !dimensions) {
      rotationRing.visible = false;
      rotationRingHitTarget.visible = false;
      rotationAngleFill.visible = false;
      return;
    }

    const center = positionToLduCenter(brick);
    updateRotationRingGeometry(radius);
    rotationRing.position.set(
      center.x,
      center.y + dimensions.height * PLATE_UNIT_LDU / 2 + 5,
      center.z,
    );
    rotationRing.rotation.set(Math.PI / 2, 0, 0);
    rotationRing.visible = true;
    rotationRing.updateMatrixWorld(true);

    rotationRingHitTarget.position.copy(rotationRing.position);
    rotationRingHitTarget.rotation.copy(rotationRing.rotation);
    rotationRingHitTarget.visible = true;
    rotationRingHitTarget.updateMatrixWorld(true);

    rotationAngleFill.position.copy(rotationRing.position);
    rotationAngleFill.rotation.copy(rotationRing.rotation);
    rotationAngleFill.updateMatrixWorld(true);
  }

  function updateRotationRing() {
    const model = getModel();
    const brick = selectedBrickId
      ? model?.bricks.find((candidate) => candidate.id === selectedBrickId)
      : null;
    syncRotationRingToBrick(brick);
  }

  function applyDraftBrickToObject(object, brick) {
    const center = positionToLduCenter(brick);
    object.position.set(center.x, center.y, center.z);
    object.rotation.y = THREE.MathUtils.degToRad(brick.rotation);
    object.updateMatrixWorld(true);
    object.userData.outline?.update?.();
  }

  function selectBrick(brickId) {
    const object = brickId ? brickScene.getBrickObject(brickId) : null;
    selectedBrickId = object ? brickId : null;
    brickScene.setSelectedBrick(selectedBrickId);
    onSelectionChange?.(selectedBrickId);

    if (tool === "axis" && object) {
      transformControls.attach(object);
    } else {
      transformControls.detach();
    }

    updateRotationRing();
  }

  function cancelHandDrag() {
    handDrag = null;
    orbitControls.enabled = true;
  }

  function cancelActiveDrag(event) {
    if (rotateDrag && (event?.pointerId == null || event.pointerId === rotateDrag.pointerId)) {
      const pointerId = rotateDrag.pointerId;
      cancelRotateDrag();
      domElement.releasePointerCapture?.(pointerId);
    }

    if (handDrag && (event?.pointerId == null || event.pointerId === handDrag.pointerId)) {
      const pointerId = handDrag.pointerId;
      cancelHandDrag();
      domElement.releasePointerCapture?.(pointerId);
    }
  }

  function intersectBrick(event) {
    updatePointer(event);
    raycaster.setFromCamera(pointer, camera);
    const intersections = raycaster.intersectObjects([...brickScene.objectsById.values()], true);

    for (const intersection of intersections) {
      const brickId = brickIdFromObject(intersection.object);

      if (brickId) {
        return brickId;
      }
    }

    return null;
  }

  function intersectRotationRing(event) {
    if (!rotationRingHitTarget.visible || !selectedBrickId) {
      return null;
    }

    updatePointer(event);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObject(rotationRingHitTarget, false)[0] ?? null;
  }

  function intersectDragPlane(event, plane) {
    updatePointer(event);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  }

  function objectWorldPosition(object) {
    return object.getWorldPosition(new THREE.Vector3());
  }

  function worldToEditorLocal(position) {
    return brickScene.root
      ? brickScene.root.worldToLocal(position.clone())
      : position.clone();
  }

  function directionFromCenter(center, point) {
    const direction = point.clone().sub(center);
    direction.y = 0;

    if (direction.lengthSq() === 0) {
      return null;
    }

    return direction.normalize();
  }

  function snappedRotationFromDrag(dragState, intersection) {
    const currentDirection = directionFromCenter(dragState.center, intersection);

    if (!currentDirection) {
      return {
        rotation: dragState.latestRotation,
        quarterTurns: dragState.latestQuarterTurns,
      };
    }

    const cross = new THREE.Vector3().crossVectors(
      dragState.startDirection,
      currentDirection,
    );
    const angleDelta = Math.atan2(
      cross.dot(dragState.up),
      dragState.startDirection.dot(currentDirection),
    );
    const snappedQuarterTurns = Math.round(angleDelta / QUARTER_TURN_RADIANS);

    return {
      rotation: THREE.MathUtils.euclideanModulo(
        dragState.startRotation + snappedQuarterTurns * 90,
        360,
      ),
      quarterTurns: snappedQuarterTurns,
    };
  }

  function angleFillGeometry(startDirection, quarterTurns) {
    const angle = quarterTurns * QUARTER_TURN_RADIANS;
    const radius = Math.max(
      ROTATION_RING_TUBE_LDU,
      (rotationRing.userData.radius ?? 0) - ROTATION_RING_TUBE_LDU,
    );

    if (!startDirection || angle === 0 || radius <= 0) {
      return null;
    }

    const startAngle = Math.atan2(startDirection.z, startDirection.x);
    const segments = Math.max(2, Math.abs(quarterTurns) * 12);
    const shape = new THREE.Shape();

    shape.moveTo(0, 0);

    for (let index = 0; index <= segments; index += 1) {
      const t = index / segments;
      const pointAngle = startAngle + angle * t;
      shape.lineTo(Math.cos(pointAngle) * radius, Math.sin(pointAngle) * radius);
    }

    shape.lineTo(0, 0);
    return new THREE.ShapeGeometry(shape);
  }

  function updateRotationAngleFill(dragState, quarterTurns = 0) {
    if (!dragState || quarterTurns === 0) {
      rotationAngleFill.visible = false;
      return;
    }

    const geometry = angleFillGeometry(dragState.startDirection, quarterTurns);

    if (!geometry) {
      rotationAngleFill.visible = false;
      return;
    }

    rotationAngleFill.geometry.dispose();
    rotationAngleFill.geometry = geometry;
    rotationAngleFill.position.copy(rotationRing.position);
    rotationAngleFill.rotation.copy(rotationRing.rotation);
    rotationAngleFill.visible = true;
    rotationAngleFill.updateMatrixWorld(true);
  }

  function startRotateDrag(event) {
    const model = getModel();
    const brick = model?.bricks.find((candidate) => candidate.id === selectedBrickId);
    const object = selectedBrickId ? brickScene.getBrickObject(selectedBrickId) : null;

    if (!brick || !object) {
      selectBrick(null);
      return false;
    }

    const center = objectWorldPosition(object);
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -center.y);
    const startIntersection = intersectDragPlane(event, dragPlane);
    const startDirection = startIntersection
      ? directionFromCenter(center, startIntersection)
      : null;

    if (!startDirection) {
      return false;
    }

    rotateDrag = {
      brickId: selectedBrickId,
      pointerId: event.pointerId,
      center,
      dragPlane,
      startDirection,
      up: new THREE.Vector3(0, 1, 0),
      startBrick: {
        ...brick,
        position: { ...brick.position },
      },
      startRotation: THREE.MathUtils.euclideanModulo(brick.rotation, 360),
      latestRotation: THREE.MathUtils.euclideanModulo(brick.rotation, 360),
      latestQuarterTurns: 0,
    };
    updateRotationAngleFill(rotateDrag, 0);
    orbitControls.enabled = false;
    domElement.setPointerCapture?.(event.pointerId);
    return true;
  }

  function cancelRotateDrag() {
    if (!rotateDrag) {
      return;
    }

    const dragState = rotateDrag;
    rotateDrag = null;
    const object = brickScene.getBrickObject(dragState.brickId);

    if (object) {
      applyDraftBrickToObject(object, dragState.startBrick);
      syncRotationRingToBrick(dragState.startBrick);
    } else {
      updateRotationRing();
    }

    updateRotationAngleFill(null);
    orbitControls.enabled = true;
  }

  function pointerDown(event) {
    if (tool === "axis" && transformControls.dragging) {
      return;
    }

    if (tool === "rotate" && intersectRotationRing(event)) {
      startRotateDrag(event);
      return;
    }

    const brickId = intersectBrick(event);

    if (!brickId) {
      selectBrick(null);
      return;
    }

    if (brickId !== selectedBrickId) {
      selectBrick(brickId);
    }

    if (tool === "rotate") {
      return;
    }

    if (tool === "axis") {
      return;
    }

    if (brickId !== selectedBrickId) {
      return;
    }

    const object = brickScene.getBrickObject(brickId);
    if (!object) {
      selectBrick(null);
      return;
    }

    const model = getModel();
    const brick = model?.bricks.find((candidate) => candidate.id === brickId);

    if (!brick) {
      selectBrick(null);
      return;
    }

    const objectWorldCenter = objectWorldPosition(object);
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -objectWorldCenter.y);
    const startIntersection = intersectDragPlane(event, dragPlane);

    if (!startIntersection) {
      return;
    }

    handDrag = {
      brickId,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPosition: { ...brick.position },
      dragPlane,
      dragOffset: startIntersection.clone().sub(objectWorldCenter),
      dragging: false,
      latestPosition: null,
    };
    orbitControls.enabled = false;
    domElement.setPointerCapture?.(event.pointerId);
  }

  function contextMenu(event) {
    const brickId = intersectBrick(event);

    if (!brickId) {
      return;
    }

    event.preventDefault();
    selectBrick(brickId);
    onBrickContextMenu?.({
      brickId,
      clientX: event.clientX,
      clientY: event.clientY,
    });
  }

  function pointerMove(event) {
    if (rotateDrag) {
      if (event.pointerId !== rotateDrag.pointerId) {
        return;
      }

      const model = getModel();
      const brick = model?.bricks.find((candidate) => candidate.id === rotateDrag.brickId);
      const object = brickScene.getBrickObject(rotateDrag.brickId);
      const intersection = intersectDragPlane(event, rotateDrag.dragPlane);

      if (!brick || !object || !intersection) {
        return;
      }

      const { rotation: nextRotation, quarterTurns } = snappedRotationFromDrag(
        rotateDrag,
        intersection,
      );
      const draftBrick = brickWithRotationPreservingCenter(
        rotateDrag.startBrick,
        nextRotation,
      );

      rotateDrag.latestRotation = draftBrick.rotation;
      rotateDrag.latestQuarterTurns = quarterTurns;
      applyDraftBrickToObject(object, draftBrick);
      syncRotationRingToBrick(draftBrick);
      updateRotationAngleFill(rotateDrag, quarterTurns);
      return;
    }

    if (tool !== "hand" || !handDrag) {
      return;
    }

    if (event.pointerId !== handDrag.pointerId) {
      return;
    }

    if (!handDrag.dragging) {
      const movement = Math.hypot(
        event.clientX - handDrag.startClientX,
        event.clientY - handDrag.startClientY,
      );

      if (movement < HAND_DRAG_THRESHOLD_PX) {
        return;
      }

      handDrag.dragging = true;
    }

    const model = getModel();
    if (!model) {
      return;
    }
    const brick = model.bricks.find((candidate) => candidate.id === handDrag.brickId);
    const object = brickScene.getBrickObject(handDrag.brickId);

    if (!brick || !object) {
      return;
    }

    const intersection = intersectDragPlane(event, handDrag.dragPlane);

    if (!intersection) {
      return;
    }

    const draggedCenter = worldToEditorLocal(intersection.sub(handDrag.dragOffset));
    const dimensions = getPartDimensions(brick.part_id, brick.rotation);

    if (!dimensions) {
      return;
    }

    const horizontalPosition = snapGridPosition({
      x: draggedCenter.x / STUD_LDU - dimensions.width / 2,
      y: draggedCenter.z / STUD_LDU - dimensions.depth / 2,
      z: handDrag.startPosition.z,
    });
    const draftBrick = { ...brick, position: horizontalPosition };
    const visualPosition = {
      ...horizontalPosition,
      z: findDropZForFootprint(draftBrick, model.bricks),
    };
    const center = positionToLduCenter({ ...brick, position: visualPosition });
    handDrag.latestPosition = visualPosition;
    object.position.set(center.x, center.y, center.z);
    object.userData.outline?.update?.();
  }

  function pointerUp(event) {
    if (rotateDrag) {
      if (event.pointerId !== rotateDrag.pointerId) {
        return;
      }

      const dragState = rotateDrag;
      rotateDrag = null;
      domElement.releasePointerCapture?.(event.pointerId);
      updateRotationAngleFill(null);
      orbitControls.enabled = true;

      const finalRotation = THREE.MathUtils.euclideanModulo(dragState.latestRotation, 360);

      if (finalRotation === dragState.startRotation) {
        const object = brickScene.getBrickObject(dragState.brickId);

        if (object) {
          applyDraftBrickToObject(object, dragState.startBrick);
          syncRotationRingToBrick(dragState.startBrick);
        }
        return;
      }

      const model = getModel();
      const brick = model?.bricks.find((candidate) => candidate.id === dragState.brickId);

      if (!brick) {
        updateRotationRing();
        return;
      }

      setModel(rotateBrickToRotation(model, dragState.brickId, finalRotation), {
        editedBrickId: dragState.brickId,
      });
      return;
    }

    if (tool !== "hand" || !handDrag) {
      return;
    }

    const dragState = handDrag;
    cancelHandDrag();

    if (event.pointerId === dragState.pointerId) {
      domElement.releasePointerCapture?.(event.pointerId);
    }

    if (!dragState.dragging) {
      return;
    }

    const model = getModel();
    const brick = model.bricks.find((candidate) => candidate.id === dragState.brickId);

    if (!brick || !dragState.latestPosition) {
      return;
    }

    const nextModel = moveBrick(model, dragState.brickId, snapGridPosition(dragState.latestPosition), {
      snap: true,
      stackOnDrop: false,
    });

    setModel(nextModel, { editedBrickId: dragState.brickId });
  }

  function snapAxisObjectToGrid() {
    if (!selectedBrickId || tool !== "axis") {
      return null;
    }

    const object = brickScene.getBrickObject(selectedBrickId);
    const brick = getModel().bricks.find((candidate) => candidate.id === selectedBrickId);

    if (!object || !brick) {
      return null;
    }
    const position = lduToGridPosition(object.position, brick);

    if (!position) {
      return null;
    }

    const gridPosition = snapGridPosition(position);
    const center = positionToLduCenter({ ...brick, position: gridPosition });

    if (
      object.position.x !== center.x ||
      object.position.y !== center.y ||
      object.position.z !== center.z
    ) {
      snappingAxisObject = true;
      try {
        object.position.set(center.x, center.y, center.z);
        object.userData.outline?.update?.();
      } finally {
        snappingAxisObject = false;
      }
    }

    return gridPosition;
  }

  function commitAxisTransform() {
    const gridPosition = snapAxisObjectToGrid();

    if (!gridPosition) {
      return;
    }

    const nextModel = moveBrick(getModel(), selectedBrickId, gridPosition, {
      snap: true,
      stackOnDrop: false,
    });
    setModel(nextModel, { editedBrickId: selectedBrickId });
    axisCommitPending = false;
  }

  function keyDown(event) {
    if (event.key !== "Escape" || !rotateDrag) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    cancelActiveDrag();
  }

  transformControls.addEventListener("dragging-changed", (event) => {
    orbitControls.enabled = !event.value;

    if (event.value) {
      axisDragActive = true;
      axisCommitPending = false;
      return;
    }

    if (axisDragActive && axisCommitPending) {
      commitAxisTransform();
    }

    axisDragActive = false;
    axisCommitPending = false;
  });

  transformControls.addEventListener("objectChange", () => {
    if (snappingAxisObject) {
      return;
    }

    if (axisDragActive) {
      axisCommitPending = Boolean(snapAxisObjectToGrid());
      return;
    }

    commitAxisTransform();
  });

  domElement.addEventListener("pointerdown", pointerDown);
  domElement.addEventListener("pointermove", pointerMove);
  domElement.addEventListener("pointerup", pointerUp);
  domElement.addEventListener("pointercancel", cancelActiveDrag);
  domElement.addEventListener("contextmenu", contextMenu);
  domElement.ownerDocument.addEventListener("keydown", keyDown);

  return {
    setTool(nextTool) {
      cancelActiveDrag();

      tool = nextTool;

      const selectedObject = selectedBrickId
        ? brickScene.getBrickObject(selectedBrickId)
        : null;
      if (tool === "axis" && selectedObject) {
        transformControls.attach(selectedObject);
      } else {
        transformControls.detach();
      }

      updateRotationAngleFill(null);
      updateRotationRing();
      return tool;
    },
    setModel() {
      updateRotationRing();
    },
    setSelectedBrickId: selectBrick,
    reset() {
      cancelActiveDrag();
      tool = "hand";
      selectBrick(null);
      transformControls.detach();
      updateRotationRing();
    },
    dispose() {
      cancelActiveDrag();
      domElement.removeEventListener("pointerdown", pointerDown);
      domElement.removeEventListener("pointermove", pointerMove);
      domElement.removeEventListener("pointerup", pointerUp);
      domElement.removeEventListener("pointercancel", cancelActiveDrag);
      domElement.removeEventListener("contextmenu", contextMenu);
      domElement.ownerDocument.removeEventListener("keydown", keyDown);
      transformControls.dispose();
      scene.remove(transformControlsHelper);
      rotationRingParent.remove(rotationRing);
      rotationRingParent.remove(rotationAngleFill);
      rotationRingParent.remove(rotationRingHitTarget);
      rotationRing.geometry.dispose();
      rotationRing.material.dispose();
      rotationAngleFill.geometry.dispose();
      rotationAngleFill.material.dispose();
      rotationRingHitTarget.geometry.dispose();
      rotationRingHitTarget.material.dispose();
    },
  };
}
