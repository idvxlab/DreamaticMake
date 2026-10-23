import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type {
  EngineFrame,
  EnginePose,
  EngineScene as SceneData,
} from "../contracts";
const identity = (text: string) => text;
export type MeshLoader = (
  asset: Extract<
    SceneData["envelopes"][number]["shape"],
    { kind: "triangle_mesh" }
  >["asset_ref"],
  signal: AbortSignal,
) => Promise<ArrayBuffer>;

function pose(object: THREE.Object3D, value: EnginePose) {
  object.position.fromArray(value.translation_m);
  object.quaternion.fromArray(value.rotation_xyzw);
}

export function EngineScene({
  scene,
  frame,
  selected,
  onSelect,
  loadMesh,
  translate: t = identity,
  highlighted = [],
  anchors = [],
  onPoseChange,
}: {
  scene: SceneData;
  frame?: EngineFrame;
  selected: string;
  onSelect: (id: string) => void;
  loadMesh?: MeshLoader;
  translate?: (text: string) => string;
  highlighted?: string[];
  anchors?: { body: string; pose: EnginePose }[];
  onPoseChange?: (body: string, pose: EnginePose) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [wire, setWire] = useState(false);
  const [spaces, setSpaces] = useState(true);
  const [error, setError] = useState("");
  const [meshProgress, setMeshProgress] = useState({ loaded: 0, total: 0 });
  const [fit, setFit] = useState(0);
  const [transformMode, setTransformMode] = useState<"translate" | "rotate">(
    "translate",
  );
  const live = useRef({
    frame,
    selected,
    onSelect,
    wire,
    spaces,
    highlighted,
    anchors,
    onPoseChange,
    transformMode,
  });
  live.current = {
    frame,
    selected,
    onSelect,
    wire,
    spaces,
    highlighted,
    anchors,
    onPoseChange,
    transformMode,
  };
  const cameraState = useRef<{
    position: THREE.Vector3;
    target: THREE.Vector3;
  } | null>(null);
  const refit = useRef<() => void>(() => {});
  useEffect(() => {
    refit.current();
  }, [fit]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setError(t("当前设备无法启用 WebGL，可下载 STEP/STL 查看。"));
      return;
    }
    setError("");
    setMeshProgress({
      loaded: 0,
      total: scene.envelopes.filter((e) => e.shape.kind === "triangle_mesh")
        .length,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    element.appendChild(renderer.domElement);
    const world = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.00001, 10000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const transform = new TransformControls(camera, renderer.domElement);
    world.add(transform.getHelper());
    transform.addEventListener("dragging-changed", (e) => {
      controls.enabled = !e.value;
    });
    transform.addEventListener("mouseUp", () => {
      const object = transform.object;
      if (object)
        live.current.onPoseChange?.(live.current.selected, {
          translation_m: object.position.toArray(),
          rotation_xyzw: object.quaternion.toArray(),
        });
    });
    world.add(new THREE.HemisphereLight(0xffffff, 0x68735e, 2.7));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(1, -2, 3);
    world.add(light);
    const bodies = new Map<string, THREE.Group>();
    for (const body of scene.bodies) {
      const group = new THREE.Group();
      if (body.world_pose) pose(group, body.world_pose);
      group.visible = !!body.world_pose;
      bodies.set(body.entity_ref, group);
      world.add(group);
    }
    const meshes: THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshStandardMaterial
    >[] = [];
    const abort = new AbortController();
    let disposed = false;
    const pending: Promise<void>[] = [];
    const addMesh = (
      geometry: THREE.BufferGeometry,
      envelope: SceneData["envelopes"][number],
    ) => {
      if (disposed) {
        geometry.dispose();
        return;
      }
      const material = new THREE.MeshStandardMaterial({
        roughness: 0.6,
        metalness: 0.08,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      pose(mesh, envelope.pose);
      mesh.userData = {
        id: envelope.entity_ref,
        body: envelope.body_ref,
        purpose: envelope.purpose,
      };
      bodies.get(envelope.body_ref)?.add(mesh);
      meshes.push(mesh);
    };
    for (const envelope of scene.envelopes) {
      const shape = envelope.shape;
      if (shape.kind === "triangle_mesh") {
        pending.push(
          (async () => {
            try {
              if (!loadMesh) throw new Error(t("未配置 STL 资产加载器"));
              const buffer = await loadMesh(shape.asset_ref, abort.signal);
              const digest = Array.from(
                new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
              )
                .map((v) => v.toString(16).padStart(2, "0"))
                .join("");
              if (digest !== shape.asset_ref.sha256)
                throw new Error(t("STL 资产哈希不匹配"));
              const geometry = new STLLoader().parse(buffer);
              const factor = { m: 1, cm: 0.01, mm: 0.001 }[shape.unit];
              geometry.scale(factor, factor, factor);
              geometry.computeVertexNormals();
              addMesh(geometry, envelope);
              if (!disposed)
                setMeshProgress((p) => ({ ...p, loaded: p.loaded + 1 }));
            } catch (e) {
              if (!disposed) setError(String(e));
            }
          })(),
        );
        continue;
      }
      let geometry: THREE.BufferGeometry;
      if (shape.kind === "box")
        geometry = new THREE.BoxGeometry(...shape.size_m);
      else if (shape.kind === "sphere")
        geometry = new THREE.SphereGeometry(shape.radius_m, 24, 16);
      else if (shape.kind === "cylinder") {
        geometry = new THREE.CylinderGeometry(
          shape.radius_m,
          shape.radius_m,
          shape.length_m,
          32,
        );
        geometry.rotateX(Math.PI / 2);
      } else if (shape.kind === "capsule") {
        geometry = new THREE.CapsuleGeometry(
          shape.radius_m,
          shape.segment_length_m,
          8,
          24,
        );
        geometry.rotateX(Math.PI / 2);
      } else continue; // Referenced convex assets are not silently approximated or fetched.
      addMesh(geometry, envelope);
    }
    const axes = new THREE.AxesHelper(0.035);
    world.add(axes);
    const anchorMarkers: THREE.Mesh[] = [];
    for (let i = 0; i < 16; i++) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.0015, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0xffd700, depthTest: false }),
      );
      marker.renderOrder = 100;
      marker.visible = false;
      world.add(marker);
      anchorMarkers.push(marker);
    }
    refit.current = () => {
      world.updateMatrixWorld(true);
      const box = new THREE.Box3();
      for (const mesh of meshes)
        if (mesh.parent?.visible) box.expandByObject(mesh);
      const center = box.isEmpty()
        ? new THREE.Vector3()
        : box.getCenter(new THREE.Vector3());
      const size = box.isEmpty()
        ? 0.1
        : Math.max(box.getSize(new THREE.Vector3()).length(), 0.01);
      controls.target.copy(center);
      camera.position
        .copy(center)
        .add(new THREE.Vector3(1.4, -1.8, 1.3).multiplyScalar(size));
      camera.near = Math.max(size / 10000, 1e-7);
      camera.far = size * 1000;
      camera.updateProjectionMatrix();
      controls.update();
    };
    refit.current();
    if (cameraState.current) {
      camera.position.copy(cameraState.current.position);
      controls.target.copy(cameraState.current.target);
      controls.update();
    }
    void Promise.all(pending).then(() => {
      if (!disposed && pending.length) refit.current();
    });
    const raycaster = new THREE.Raycaster();
    let down = [0, 0];
    const pointerDown = (e: PointerEvent) => {
      down = [e.clientX, e.clientY];
    };
    const pick = (e: PointerEvent) => {
      if (transform.axis) return;
      if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          (-(e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const hit = raycaster.intersectObjects(
        meshes.filter((mesh) => mesh.visible && mesh.parent?.visible),
        false,
      )[0];
      live.current.onSelect(hit?.object.userData.body ?? "");
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pick);
    const resize = () => {
      const width = Math.max(1, element.clientWidth),
        height = Math.max(1, element.clientHeight);
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    let animation = 0;
    const animate = () => {
      animation = requestAnimationFrame(animate);
      const state = live.current;
      const target = state.onPoseChange
        ? bodies.get(state.selected)
        : undefined;
      if (target && transform.object !== target) transform.attach(target);
      else if (!target && transform.object) transform.detach();
      transform.setMode(state.transformMode);
      const collisions = new Set(
        (state.frame?.collisions ?? scene.collisions).flat(),
      );
      for (const body of scene.bodies) {
        const group = bodies.get(body.entity_ref)!;
        const placement = state.frame
          ? state.frame.body_poses[body.entity_ref]
          : body.world_pose;
        group.visible = !!placement;
        if (placement && !(transform.dragging && transform.object === group))
          pose(group, placement);
      }
      for (const mesh of meshes) {
        const { id, body, purpose } = mesh.userData;
        const auxiliary = purpose !== "solid";
        mesh.visible = !auxiliary || state.spaces;
        mesh.material.color.set(
          collisions.has(id)
            ? 0xd46651
            : body === state.selected || state.highlighted.includes(body)
              ? 0xc0d981
              : purpose === "keepout"
                ? 0xd9a461
                : purpose === "service"
                  ? 0x76a4b1
                  : 0x839375,
        );
        mesh.material.wireframe = state.wire || auxiliary;
        mesh.material.transparent = auxiliary;
        mesh.material.opacity = auxiliary ? 0.5 : 1;
        mesh.material.emissive.set(
          state.highlighted.includes(body) ? 0x685213 : 0x000000,
        );
        mesh.material.depthTest = !state.highlighted.includes(body);
      }
      anchorMarkers.forEach((marker, index) => {
        const anchor = state.anchors[index],
          group = anchor && bodies.get(anchor.body);
        marker.visible = !!group;
        if (group && anchor) {
          group.updateMatrixWorld(true);
          marker.position.fromArray(anchor.pose.translation_m);
          group.localToWorld(marker.position);
        }
      });
      controls.update();
      renderer.render(world, camera);
    };
    animate();
    return () => {
      disposed = true;
      abort.abort();
      cancelAnimationFrame(animation);
      observer.disconnect();
      cameraState.current = {
        position: camera.position.clone(),
        target: controls.target.clone(),
      };
      transform.dispose();
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointerup", pick);
      meshes.forEach((mesh) => {
        mesh.geometry.dispose();
        mesh.material.dispose();
      });
      axes.geometry.dispose();
      (axes.material as THREE.Material).dispose();
      anchorMarkers.forEach((marker) => {
        marker.geometry.dispose();
        (marker.material as THREE.Material).dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
      refit.current = () => {};
    };
  }, [scene, loadMesh, t]);
  const unavailable =
    scene.envelopes.filter((e) => e.shape.kind === "convex_asset").length +
    scene.visual_assets.length;
  return (
    <div
      className="model-stage engine-scene"
      data-body-count={scene.bodies.length}
      data-loaded-meshes={meshProgress.loaded}
      data-highlighted-bodies={highlighted.join(",")}
    >
      <div className="viewer" ref={host} aria-label={t("引擎三维场景")} />
      <div className="viewer-label">
        <i />
        {t("引擎包络 · m · Z 向上")}
        {!!meshProgress.total && (
          <span>
            {" "}
            · STL {meshProgress.loaded}/{meshProgress.total}
          </span>
        )}
      </div>
      {!!unavailable && (
        <div className="engine-asset-note">
          {t("外部网格未加载，仅显示声明包络")}
        </div>
      )}
      <div className="viewer-controls">
        <button onClick={() => setFit((n) => n + 1)}>{t("适应视图")}</button>
        {onPoseChange && (
          <button
            onClick={() =>
              setTransformMode(
                transformMode === "translate" ? "rotate" : "translate",
              )
            }
          >
            {t(transformMode === "translate" ? "移动实体" : "旋转实体")}
          </button>
        )}
        <button
          aria-pressed={wire}
          className={wire ? "active" : ""}
          onClick={() => setWire(!wire)}
        >
          {t("线框")}
        </button>
        <button
          aria-pressed={spaces}
          className={spaces ? "active" : ""}
          onClick={() => setSpaces(!spaces)}
        >
          {t("保留空间")}
        </button>
      </div>
      {error && (
        <div className="viewer-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
