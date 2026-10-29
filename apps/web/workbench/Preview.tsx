import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type { Packet } from "../../../packages/workbench/contracts";
import { placementCenter } from "../../../packages/workbench/placement";

export function Preview({
  packets,
  view,
  exploded,
}: {
  packets: Packet[];
  view: string;
  exploded: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [retry, setRetry] = useState(0);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const signature = JSON.stringify(packets);

  useEffect(() => {
    if (!host.current) return;
    const el = host.current;
    setMessages({});
    delete el.dataset.modelError;
    const report = (id: string, message: string) =>
      setMessages((m) => ({ ...m, [id]: message }));
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      report("webgl", "当前环境不支持 WebGL；仍可查看流程与证据。");
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#e9ece8");
    const camera = new THREE.OrthographicCamera(
      -150,
      150,
      150,
      -150,
      0.1,
      10000,
    );
    let fitSpan = 300;
    const positions: Record<string, number[]> = {
      perspective: [160, 280, 170],
      front: [0, 380, 0],
      top: [0, -0.01, 380],
      right: [380, 0, 0],
    };
    camera.up.set(0, 0, 1);
    camera.position.fromArray(positions[view] ?? positions.perspective);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x60685e, 3));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(100, -100, 200);
    scene.add(light);
    const grid = new THREE.GridHelper(500, 25, 0xa5afa2, 0xcbd2c8);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -1;
    scene.add(grid);
    const group = new THREE.Group();
    let disposed = false;
    const abort = new AbortController();
    scene.add(group);
    // Only draw explicitly declared envelopes, never pretend these are CAD meshes.
    const items = new Map<string, Packet["data"]["structure"][number]>();
    packets.forEach((p) => p.data.structure.forEach((i) => items.set(i.id, i)));
    let index = 0;
    for (const item of items.values()) {
      const dims = item.properties.dimensionsMm;
      if (
        !Array.isArray(dims) ||
        dims.length !== 3 ||
        !dims.every(
          (n) =>
            typeof n === "number" && Number.isFinite(n) && n > 0 && n < 10000,
        )
      )
        continue;
      const isAppearance = !!item.properties.appearanceRef;
      const geometry: THREE.BufferGeometry = new THREE.BoxGeometry(
        dims[0],
        dims[1],
        dims[2],
      );
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color: [0x859a77, 0xc5bba5, 0x96aab6, 0xd5ab6c][index % 4],
          roughness: 0.65,
          transparent: true,
          opacity: 0.72,
        }),
      );
      const pos = placementCenter(item.properties);
      if (
        Array.isArray(pos) &&
        pos.length === 3 &&
        pos.every((n) => typeof n === "number" && Number.isFinite(n))
      )
        mesh.position.fromArray(pos);
      if (exploded) mesh.position.z += index * 22;
      const rotation = item.properties.rotationDeg;
      if (
        Array.isArray(rotation) &&
        rotation.length === 3 &&
        rotation.every((n) => typeof n === "number" && Number.isFinite(n))
      )
        mesh.rotation.set(
          ...(rotation.map((n) => THREE.MathUtils.degToRad(n)) as [
            number,
            number,
            number,
          ]),
        );
      mesh.add(
        new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry),
          new THREE.LineBasicMaterial({ color: 0x52644a }),
        ),
      );
      mesh.visible = !isAppearance;
      group.add(mesh);
      const meshUrl = item.properties.meshUrl;
      if (
        ["step_file_bounds", "appearance_file_bounds"].includes(
          String(item.properties.dimensionsEvidence),
        ) &&
        typeof meshUrl === "string" &&
        (meshUrl.startsWith("/workbench-api/library/mesh?") ||
          (isAppearance && meshUrl.startsWith("/workbench-api/appearance/")))
      ) {
        report(item.id, `${item.label}：正在加载真实网格`);
        void fetch(meshUrl, { signal: abort.signal })
          .then((r) => {
            if (!r.ok) throw new Error("库模型读取失败");
            return r.arrayBuffer();
          })
          .then((data) => {
            if (disposed) return;
            const real = new STLLoader().parse(data);
            if (!real.getAttribute("position")?.count)
              throw new Error("网格为空");
            real.computeVertexNormals();
            real.computeBoundingBox();
            const center = real.boundingBox!.getCenter(new THREE.Vector3());
            real.translate(-center.x, -center.y, -center.z);
            mesh.children.forEach((child) => {
              if (child instanceof THREE.LineSegments) {
                child.geometry.dispose();
                (child.material as THREE.Material).dispose();
              }
            });
            mesh.clear();
            mesh.geometry.dispose();
            mesh.geometry = real;
            const material = mesh.material as THREE.MeshStandardMaterial;
            mesh.visible = true;
            material.transparent = isAppearance;
            material.opacity = isAppearance ? 0.2 : 1;
            material.depthWrite = !isAppearance;
            if (isAppearance)
              mesh.add(
                new THREE.LineSegments(
                  new THREE.EdgesGeometry(real, 35),
                  new THREE.LineBasicMaterial({
                    color: 0x52644a,
                    transparent: true,
                    opacity: 0.45,
                  }),
                ),
              );
            material.needsUpdate = true;
            report(item.id, `${item.label}：真实网格已加载`);
          })
          .catch(() => {
            if (!disposed) {
              const message = isAppearance
                ? "真实外形加载失败，未用包络替代"
                : "真实网格加载失败，当前保留尺寸包络";
              el.dataset.modelError = message;
              report(item.id, `${item.label}：${message}`);
            }
          });
      } else
        report(
          item.id,
          `${item.label}：${isAppearance ? "缺少可加载的外形网格，未显示替代体" : "当前显示尺寸包络"}`,
        );
      index++;
    }
    if (group.children.length) {
      const box = new THREE.Box3().setFromObject(group),
        center = box.getCenter(new THREE.Vector3());
      const size = Math.max(...box.getSize(new THREE.Vector3()).toArray(), 30);
      controls.target.copy(center);
      fitSpan = size * 1.3;
      camera.position
        .sub(new THREE.Vector3())
        .normalize()
        .multiplyScalar(size * 2.9)
        .add(center);
      grid.position.z = box.min.z - 1;
    }
    const resize = () => {
      const { width, height } = el.getBoundingClientRect();
      renderer.setSize(width, height);
      const aspect = width / Math.max(height, 1);
      const heightMm = fitSpan / Math.min(1, Math.max(0.1, aspect));
      camera.left = (-heightMm * aspect) / 2;
      camera.right = (heightMm * aspect) / 2;
      camera.top = heightMm / 2;
      camera.bottom = -heightMm / 2;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();
    return () => {
      disposed = true;
      abort.abort();
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose();
          const m = o.material;
          (Array.isArray(m) ? m : [m]).forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [signature, view, exploded, retry]);
  const values = Object.values(messages);
  const failed = values.filter((m) => /失败|缺少|不支持/.test(m)).length;
  const loaded = values.filter((m) => /真实网格已加载/.test(m)).length;
  const envelopes = values.filter((m) => /当前显示尺寸包络/.test(m)).length;
  const loading = values.filter((m) => /正在加载/.test(m)).length;
  return (
    <>
      <div className="three-host" ref={host} />
      <details className="mesh-status" open={failed > 0}>
        <summary aria-live="polite">
          预览：{loaded} 网格已加载 · {envelopes} 包络
          {loading > 0 ? ` · ${loading} 加载中` : ""}
          {failed > 0 ? ` · ${failed} 失败，展开查看` : ""}
        </summary>
        <div role="status" aria-live="polite">
          {Object.entries(messages).map(([id, message]) => (
            <p key={id}>{message}</p>
          ))}
        </div>
        <button onClick={() => setRetry((v) => v + 1)}>重新加载网格</button>
      </details>
    </>
  );
}
