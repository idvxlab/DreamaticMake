import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";

type Point = { x: number; y: number };
type Camera = Point & { zoom: number };
type Size = { width: number; height: number };
type CardId = string;
type Positions = Partial<Record<CardId, Point>>;
type Sizes = Partial<Record<CardId, Size>>;
type Drag = { pointer: number; start: Point; origin: Point; node?: string; moved: boolean };
type Pinch = { center: Point; distance: number; camera: Camera };
type GraphNode = { id: string; title: string; role: string; status: string; summary: string; inputs: readonly string[] };

const initialCamera = { x: 28, y: 70, zoom: 0.85 };
const defaultSize = { width: 210, height: 90 };
const clampZoom = (zoom: number) => Math.min(1.8, Math.max(0.2, zoom));
const magnitude = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function homeCamera(board: HTMLDivElement | null) {
  if (board && board.clientWidth > 0 && board.clientWidth < 540) {
    return { x: 16, y: 24, zoom: Math.max(0.2, Math.min(initialCamera.zoom, (board.clientWidth - 32) / 480)) };
  }
  return initialCamera;
}

function revealOffset(start: number, size: number, viewport: number) {
  const inset = Math.min(24, viewport * 0.1);
  if (size + 2 * inset > viewport) return (viewport - size) / 2 - start;
  if (start < inset) return inset - start;
  return Math.min(0, viewport - inset - start - size);
}

function zoomAt(camera: Camera, anchor: Point, zoom: number, target = anchor): Camera {
  return {
    zoom,
    x: target.x - (anchor.x - camera.x) * zoom / camera.zoom,
    y: target.y - (anchor.y - camera.y) * zoom / camera.zoom,
  };
}

function wire(a: Point, aSize: Size, b: Point, bSize: Size) {
  const direction = b.x + bSize.width / 2 >= a.x + aSize.width / 2 ? 1 : -1;
  const start = { x: a.x + (direction === 1 ? aSize.width : 0), y: a.y + aSize.height / 2 };
  const end = { x: b.x + (direction === 1 ? 0 : bSize.width), y: b.y + bSize.height / 2 };
  const bend = Math.max(15, Math.min(80, Math.abs(end.x - start.x) / 2));
  return `M ${start.x} ${start.y} C ${start.x + direction * bend} ${start.y} ${end.x - direction * bend} ${end.y} ${end.x} ${end.y}`;
}

export function WorkflowGraph({ nodes, selected, initialNode, followNode, onSelect, onBrief }: {
  nodes: GraphNode[];
  selected?: string;
  initialNode?: string;
  followNode?: string;
  onSelect: (node: string) => void;
  onBrief: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const camera = useRef<Camera>(initialCamera);
  const positions = useRef<Positions>({});
  const frame = useRef<number | null>(null);
  const drag = useRef<Drag | null>(null);
  const touches = useRef(new Map<number, Point>());
  const pinch = useRef<Pinch | null>(null);
  const suppressClick = useRef<string | undefined>(undefined);
  const [snapshot, setSnapshot] = useState({ camera: initialCamera, positions: {} as Positions });
  const [sizes, setSizes] = useState<Sizes>({});
  const [grabbing, setGrabbing] = useState(false);

  const base = useMemo(() => {
    const coordinates: Positions = { brief: { x: 0, y: 0 } };
    const layers = new Map<string, number>();
    const rows = new Map<number, number>();
    for (const node of nodes) {
      const layer = 1 + Math.max(0, ...node.inputs.map((id) => layers.get(id) ?? 0));
      const row = rows.get(layer) ?? 0;
      layers.set(node.id, layer);
      rows.set(layer, row + 1);
      coordinates[node.id] = { x: 25 + layer * 245, y: row * 135 };
    }
    return coordinates;
  }, [nodes]);
  const shown = { ...base, ...snapshot.positions };

  function paint() {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setSnapshot({ camera: camera.current, positions: positions.current });
    });
  }

  useLayoutEffect(() => {
    const board = host.current;
    const home = homeCamera(board);
    const point = initialNode ? base[initialNode] : undefined;
    camera.current = board?.clientWidth && point
      ? { ...home, x: board.clientWidth / 2 - (point.x + defaultSize.width / 2) * home.zoom }
      : home;
    setSnapshot({ camera: camera.current, positions: {} });
  }, []);

  // Only reveal on a change of followed node, so live events don't undo a pan.
  useLayoutEffect(() => {
    const board = host.current;
    if (!followNode || !board?.clientWidth || !board.clientHeight) return;
    const point = positions.current[followNode] ?? base[followNode];
    if (!point) return;
    const size = sizes[followNode] ?? defaultSize;
    const current = camera.current;
    const dx = revealOffset(current.x + point.x * current.zoom, size.width * current.zoom, board.clientWidth);
    const dy = revealOffset(current.y + point.y * current.zoom, size.height * current.zoom, board.clientHeight);
    if (!dx && !dy) return;
    camera.current = { ...current, x: current.x + dx, y: current.y + dy };
    setSnapshot({ camera: camera.current, positions: positions.current });
  }, [followNode]);

  useLayoutEffect(() => {
    const cards = world.current?.querySelectorAll<HTMLElement>("[data-card]");
    if (!cards) return;
    function measure() {
      const next: Sizes = {};
      for (const card of cards!) {
        const style = getComputedStyle(card);
        next[card.dataset.card as CardId] = { width: parseFloat(style.width), height: parseFloat(style.height) };
      }
      setSizes(next);
    }
    measure();
    const observer = new ResizeObserver(measure);
    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [nodes.length]);

  useEffect(() => {
    const board = host.current;
    if (!board) return;
    function wheel(event: WheelEvent) {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? board!.clientHeight : 1;
      const current = camera.current;
      if (event.ctrlKey || event.metaKey) {
        const rect = board!.getBoundingClientRect();
        const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        camera.current = zoomAt(current, point, clampZoom(current.zoom - event.deltaY * unit * 0.003));
      } else {
        camera.current = { ...current, x: current.x - event.deltaX * unit, y: current.y - event.deltaY * unit };
      }
      paint();
    }
    board.addEventListener("wheel", wheel, { passive: false });
    return () => {
      board.removeEventListener("wheel", wheel);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, []);

  function localPoint(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    const node = target?.dataset.stage;
    const point = localPoint(event);
    suppressClick.current = undefined;
    if (event.pointerType === "touch") {
      if (touches.current.size >= 2) return;
      touches.current.set(event.pointerId, point);
      if (touches.current.size === 2) {
        const [a, b] = [...touches.current.values()];
        suppressClick.current = drag.current?.node;
        drag.current = null;
        pinch.current = { center: midpoint(a, b), distance: Math.max(1, magnitude(a, b)), camera: camera.current };
        event.currentTarget.setPointerCapture(event.pointerId);
        setGrabbing(true);
        return;
      }
    }
    if (drag.current || (target && !node)) return;
    const origin = node ? positions.current[node] ?? base[node]! : camera.current;
    drag.current = { pointer: event.pointerId, start: point, origin, node, moved: false };
    (target ?? event.currentTarget).setPointerCapture(event.pointerId);
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const point = localPoint(event);
    if (touches.current.has(event.pointerId)) {
      touches.current.set(event.pointerId, point);
      const gesture = pinch.current;
      if (gesture && touches.current.size === 2) {
        const [a, b] = [...touches.current.values()];
        const zoom = clampZoom(gesture.camera.zoom * magnitude(a, b) / gesture.distance);
        camera.current = zoomAt(gesture.camera, gesture.center, zoom, midpoint(a, b));
        paint();
        return;
      }
    }
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    if (!current.moved && magnitude(point, current.start) < 4) return;
    if (!current.moved) setGrabbing(true);
    current.moved = true;
    const dx = point.x - current.start.x;
    const dy = point.y - current.start.y;
    if (current.node) {
      const zoom = camera.current.zoom;
      positions.current = {
        ...positions.current,
        [current.node]: { x: current.origin.x + dx / zoom, y: current.origin.y + dy / zoom },
      };
    } else {
      camera.current = { ...camera.current, x: current.origin.x + dx, y: current.origin.y + dy };
    }
    paint();
  }

  function pointerEnd(event: PointerEvent<HTMLDivElement>) {
    touches.current.delete(event.pointerId);
    if (pinch.current) {
      pinch.current = null;
      setGrabbing(false);
    }
    if (drag.current?.pointer !== event.pointerId) return;
    if (drag.current.moved) suppressClick.current = drag.current.node;
    drag.current = null;
    setGrabbing(false);
  }

  function reset() {
    camera.current = homeCamera(host.current);
    positions.current = {};
    paint();
  }

  function fit() {
    const board = host.current;
    if (!board) return;
    const cards = Object.entries(shown) as [CardId, Point][];
    const left = Math.min(...cards.map(([, p]) => p.x));
    const top = Math.min(...cards.map(([, p]) => p.y));
    const right = Math.max(...cards.map(([id, p]) => p.x + (sizes[id] ?? defaultSize).width));
    const bottom = Math.max(...cards.map(([id, p]) => p.y + (sizes[id] ?? defaultSize).height));
    const zoom = Math.min(1, clampZoom(Math.min((board.clientWidth - 48) / (right - left), (board.clientHeight - 48) / (bottom - top))));
    camera.current = { zoom, x: 24 - left * zoom, y: 24 - top * zoom };
    paint();
  }

  const { x, y, zoom } = snapshot.camera;
  return (
    <section className="wf-graph">
      <div className="wf-graph-head">
        <b>工作流程</b>
        <span>可拖动画布 · 双指平移 / 捏合缩放</span>
        <button type="button" onClick={fit}>适应画布</button>
        <button type="button" onClick={reset}>重置画布</button>
      </div>
      <div className={`wf-canvas${grabbing ? " grabbing" : ""}`} ref={host}
        onPointerDown={pointerDown} onPointerMove={pointerMove}
        onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={pointerEnd}>
        <div className="wf-world" ref={world} style={{ transform: `translate(${x}px,${y}px) scale(${zoom})` }}>
          <svg width="1" height="1" aria-hidden="true">
            {nodes.flatMap((node) => {
              const dependencies = node.inputs.filter((id) => shown[id]);
              const inputs: readonly CardId[] = dependencies.length ? dependencies : ["brief"];
              return inputs.map((from) => (
                <path key={`${from}:${node.id}`} data-from={from} data-to={node.id}
                  d={wire(shown[from]!, sizes[from] ?? defaultSize, shown[node.id]!, sizes[node.id] ?? defaultSize)} />
              ));
            })}
          </svg>
          <button className="wf-brief-node" data-card="brief" onClick={onBrief}>
            <small>需求起点</small><b>原始需求</b>
          </button>
          {nodes.map((node) => {
            const point = shown[node.id]!;
            return (
              <button key={node.id} className={`wf-node${selected === node.id ? " selected" : ""}`}
                data-card={node.id} data-stage={node.id} aria-pressed={selected === node.id}
                style={{ left: point.x, top: point.y }}
                onClick={(event) => {
                  if (event.detail && suppressClick.current === node.id) {
                    suppressClick.current = undefined;
                    return;
                  }
                  onSelect(node.id);
                }}>
                <small>{node.role} · {node.status}</small>
                <strong>{node.title}</strong>
                <span>{node.summary}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
