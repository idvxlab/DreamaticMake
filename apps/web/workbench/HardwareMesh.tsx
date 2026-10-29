import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export function HardwareMesh({ url }: { url: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const el = host.current!;
    delete el.dataset.error;
    setStatus("正在加载真实硬件网格");
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setStatus("WebGL不可用；可下载原始STEP并查看实际包络。");
      return;
    }
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#edf0e9");
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x53624d, 3));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(100, -200, 300);
    scene.add(light);
    const abort = new AbortController();
    let disposed = false;
    let mesh:
      | THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
      | undefined;
    fetch(url, { signal: abort.signal })
      .then((r) => {
        if (!r.ok) throw new Error("模型网格读取失败");
        return r.arrayBuffer();
      })
      .then((data) => {
        if (disposed) return;
        const geometry = new STLLoader().parse(data);
        if (!geometry.getAttribute("position")?.count)
          throw new Error("模型网格为空");
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        const size = geometry.boundingBox!.getSize(new THREE.Vector3());
        const center = geometry.boundingBox!.getCenter(new THREE.Vector3());
        geometry.translate(-center.x, -center.y, -center.z);
        mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({
            color: "#93a77c",
            roughness: 0.55,
            metalness: 0.12,
          }),
        );
        scene.add(mesh);
        setStatus("真实硬件网格已加载；装配与制造未验证");
        const extent = Math.max(size.x, size.y, size.z, 1);
        camera.position.set(extent * 1.6, -extent * 1.9, extent * 1.4);
        camera.near = extent / 1000;
        camera.far = extent * 100;
        camera.updateProjectionMatrix();
        controls.target.set(0, 0, 0);
        controls.update();
      })
      .catch((e) => {
        if (!disposed) setStatus(`加载失败：${e.message}`);
      });
    const resize = new ResizeObserver(() => {
      const w = el.clientWidth,
        h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    resize.observe(el);
    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });
    return () => {
      disposed = true;
      abort.abort();
      resize.disconnect();
      controls.dispose();
      renderer.setAnimationLoop(null);
      mesh?.geometry.dispose();
      mesh?.material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [url, retry]);
  return (
    <div className="hardware-mesh-wrapper">
      <div
        className="hardware-mesh"
        ref={host}
        aria-label="真实硬件STEP网格预览"
      />
      <p role="status">{status}</p>
      <button onClick={() => setRetry((v) => v + 1)}>重新加载模型</button>
    </div>
  );
}
