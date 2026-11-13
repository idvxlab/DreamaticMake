import { useEffect, useRef, useState } from "react";
import {
  Color, DirectionalLight, DoubleSide, GridHelper, HemisphereLight, Mesh, MeshStandardMaterial,
  PerspectiveCamera, Scene, Vector3, WebGLRenderer, type BufferGeometry,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

export default function CadViewport({ url }: { url: string }) {
  const host = useRef<HTMLDivElement>(null);
  const fit = useRef<() => void>(undefined);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable" | "error">("loading");

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true });
    } catch {
      setStatus("unavailable");
      return;
    }
    setStatus("loading");
    const request = new AbortController();
    const scene = new Scene();
    scene.background = new Color("#f6f7f3");
    const camera = new PerspectiveCamera(36, 1, 0.01, 100);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.minDistance = 0.12;
    controls.maxDistance = 32;
    const material = new MeshStandardMaterial({ color: "#889b82", roughness: 0.62, side: DoubleSide });
    const grid = new GridHelper(4, 16, "#c7cfc2", "#dce1d8");
    grid.rotation.x = Math.PI / 2;
    scene.add(new HemisphereLight(0xffffff, 0x798977, 2.2));
    const key = new DirectionalLight(0xffffff, 2.7);
    key.position.set(4, -6, 9);
    scene.add(key);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.setAttribute("aria-label", "可交互的 CAD 模型");
    renderer.domElement.setAttribute("role", "img");
    element.appendChild(renderer.domElement);
    const render = () => renderer.render(scene, camera);
    const resize = new ResizeObserver(() => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      render();
    });
    resize.observe(element);
    controls.addEventListener("change", render);
    const onContextLost = (event: Event) => {
      event.preventDefault();
      setStatus("unavailable");
    };
    const onContextRestored = () => {
      if (geometry) {
        setStatus("ready");
        render();
      }
    };
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    renderer.domElement.addEventListener("webglcontextrestored", onContextRestored);

    let geometry: BufferGeometry | undefined;
    void (async () => {
      try {
        const response = await fetch(url, { signal: request.signal });
        if (!response.ok) throw new Error(`STL HTTP ${response.status}`);
        const data = await response.arrayBuffer();
        if (request.signal.aborted) return;
        geometry = new STLLoader().parse(data);
        geometry.computeBoundingSphere();
        const sphere = geometry.boundingSphere;
        if (!sphere || geometry.getAttribute("position").count < 3 ||
            !Number.isFinite(sphere.radius) || sphere.radius <= 0 ||
            !sphere.center.toArray().every(Number.isFinite)) throw new Error("Invalid STL");
        geometry.translate(-sphere.center.x, -sphere.center.y, -sphere.center.z);
        geometry.scale(1 / sphere.radius, 1 / sphere.radius, 1 / sphere.radius);
        geometry.computeBoundingBox();
        grid.position.z = geometry.boundingBox!.min.z - 0.025;
        scene.add(grid, new Mesh(geometry, material));
        fit.current = () => {
          const angle = Math.min(1, camera.aspect) * Math.tan(camera.fov * Math.PI / 360);
          const distance = 1.15 / Math.sin(Math.atan(angle));
          controls.target.set(0, 0, 0);
          camera.position.copy(new Vector3(1, -1.45, 0.85).normalize().multiplyScalar(distance));
          controls.maxDistance = Math.max(32, distance * 3);
          controls.update();
          render();
        };
        fit.current();
        setStatus("ready");
      } catch {
        if (!request.signal.aborted) setStatus("error");
      }
    })();

    return () => {
      request.abort();
      fit.current = undefined;
      resize.disconnect();
      controls.removeEventListener("change", render);
      controls.dispose();
      geometry?.dispose();
      material.dispose();
      grid.dispose();
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [url]);

  return <div className="wf-cad-viewer">
    <div className="wf-cad-surface" ref={host} />
    {status === "ready"
      ? <button type="button" onClick={() => fit.current?.()}>适应视图</button>
      : <p role="status">{status === "loading" ? "正在加载 3D 模型…" : status === "unavailable"
        ? "当前浏览器无法启用 3D 预览，可下载 CAD 文件查看。"
        : "3D 模型加载失败，可下载 CAD 文件查看。"}</p>}
  </div>;
}
