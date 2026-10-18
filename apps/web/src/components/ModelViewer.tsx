import { t, useLanguage } from "../i18n";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type {
  Artifact,
  Enclosure,
} from "../../../../packages/core/src/contracts";
import { artifactURL } from "../api";
export function ModelViewer({
  parameters,
  artifacts,
  projectId,
}: {
  parameters: Enclosure;
  artifacts: Artifact[];
  projectId: string;
}) {
  useLanguage();
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [exploded, setExploded] = useState(false),
    [wire, setWire] = useState(false);
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
    const scene = new THREE.Scene();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.setClearColor(0xe7e6df, 0);
    element.appendChild(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
    const extent = Math.max(
      parameters.width,
      parameters.depth,
      parameters.height,
    );
    camera.position.set(extent * 1.9, extent * 1.6, extent * 1.9);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const ambient = new THREE.HemisphereLight(0xffffff, 0x706b5f, 3);
    scene.add(ambient);
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(80, 180, 90);
    scene.add(light);
    const grid = new THREE.GridHelper(400, 20, 0xc9c8bd, 0xd8d7ce);
    grid.position.y = -1;
    scene.add(grid);
    const group = new THREE.Group();
    group.rotation.x = -Math.PI / 2;
    scene.add(group);
    const meshes: THREE.Mesh[] = [];
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    let disposed = false;
    const abort = new AbortController();
    function add(geometry: THREE.BufferGeometry, color: number, name: string) {
      if (disposed) {
        geometry.dispose();
        return;
      }
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.62,
        metalness: 0.12,
        wireframe: wire,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      if (name === "lid" && artifacts.some((a) => a.name === "lid.stl")) {
        mesh.rotation.x = Math.PI;
        mesh.position.z = parameters.height;
      }
      if (exploded && name === "lid") mesh.position.z += 30;
      meshes.push(mesh);
      geometries.push(geometry);
      materials.push(material);
      group.add(mesh);
    }
    const stls = artifacts.filter((a) => a.name.endsWith(".stl"));
    if (stls.length) {
      const loader = new STLLoader();
      for (const a of stls)
        void fetch(artifactURL(projectId, a.id), { signal: abort.signal })
          .then((r) => {
            if (!r.ok) throw new Error(t("模型版本失效"));
            return r.arrayBuffer();
          })
          .then((buffer) =>
            add(
              loader.parse(buffer),
              a.name.startsWith("reference-")
                ? 0xce9264
                : a.name === "lid.stl"
                  ? 0xccdf89
                  : 0x777f6b,
              a.name === "lid.stl" ? "lid" : "base",
            ),
          )
          .catch((e) => {
            if (!disposed) setError(String(e));
          });
    } else {
      const p = parameters;
      const boxes: [[number, number, number], [number, number, number]][] = [
        [
          [p.width, p.depth, p.wall],
          [0, 0, p.wall / 2],
        ],
        [
          [p.wall, p.depth, p.height - p.lid],
          [(-p.width + p.wall) / 2, 0, (p.height - p.lid) / 2],
        ],
        [
          [p.wall, p.depth, p.height - p.lid],
          [(p.width - p.wall) / 2, 0, (p.height - p.lid) / 2],
        ],
        [
          [p.width - 2 * p.wall, p.wall, p.height - p.lid],
          [0, (-p.depth + p.wall) / 2, (p.height - p.lid) / 2],
        ],
        [
          [p.width - 2 * p.wall, p.wall, p.height - p.lid],
          [0, (p.depth - p.wall) / 2, (p.height - p.lid) / 2],
        ],
      ];
      for (const [size, pos] of boxes) {
        const g = new THREE.BoxGeometry(...size);
        g.translate(...pos);
        add(g, 0x7b826e, "base");
      }
      const lid = new THREE.BoxGeometry(p.width, p.depth, p.lid);
      lid.translate(0, 0, p.height - p.lid / 2);
      add(lid, 0xc6d989, "lid");
    }
    const resize = () => {
      const width = element.clientWidth,
        height = element.clientHeight;
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    let frame = 0;
    function animate() {
      frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();
    return () => {
      disposed = true;
      abort.abort();
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [parameters, artifacts, projectId, exploded, wire]);
  return (
    <div className="model-stage">
      <div className="viewer" ref={host} />
      <div className="viewer-label">
        <i />
        {artifacts.some((a) => a.name.endsWith(".stl"))
          ? t("真实 CAD 网格 · mm")
          : t("参数外形预览 · 尚未生成工程 CAD")}
      </div>
      <div className="viewer-controls">
        <button
          onClick={() => setExploded(!exploded)}
          className={exploded ? "active" : ""}
        >
          {t("爆炸视图")}{" "}
        </button>
        <button onClick={() => setWire(!wire)} className={wire ? "active" : ""}>
          {t("线框")}{" "}
        </button>
        <span>{t("拖动旋转 · 滚轮缩放")}</span>
      </div>
      {error && (
        <div className="viewer-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
