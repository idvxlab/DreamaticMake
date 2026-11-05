import "./TopologyGraph.css";
import { useId, useRef, useState } from "react";
import type { GraphProjection } from "../contracts";

const identity = (text: string) => text;
const colors = { electrical: "#bd8940", material: "#348c88", information: "#7674bd" };
const width = 820, nodeWidth = 280, rowHeight = 28, portStart = 78, stub = 14;
type GraphPort = GraphProjection["ports"][string];
type PortEntry = { ref: string; port: GraphPort; side: "left" | "right"; row: number };
function short(text: string, budget: number) {
  let result = "", used = 0;
  for (const char of text) {
    used += char.charCodeAt(0) > 255 ? 2 : 1;
    if (used > budget) return result + "…";
    result += char;
  }
  return result;
}
function nodePorts(graph: GraphProjection, id: string): PortEntry[] {
  let left = 0, right = 0;
  return Object.entries(graph.ports).filter(([, port]) => port.entity === id).map(([ref, port]) => {
    let side: "left" | "right";
    if (["power_in", "ground", "input"].includes(port.role) || port.direction === "in") side = "left";
    else if (["power_out", "output"].includes(port.role) || port.direction === "out") side = "right";
    else side = left <= right ? "left" : "right";
    return { ref, port, side, row: side === "left" ? left++ : right++ };
  });
}

export function TopologyGraph({ graph, selected, onSelect, onHover, samples = {}, translate: t = identity }: {
  graph: GraphProjection; selected: string; onSelect: (ref: string) => void; onHover: (refs: string[]) => void;
  samples?: Record<string, unknown>; translate?: (text: string) => string;
}) {
  const [positions, setPositions] = useState<Record<string, [number, number]>>({});
  const [filter, setFilter] = useState("all");
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const markerId = useId().replace(/:/g, "");
  const entries = new Map(graph.nodes.map((node) => [node.id, nodePorts(graph, node.id)]));
  const nodeHeight = (id: string) => Math.max(120, portStart + Math.max(0, ...(entries.get(id) ?? []).map((port) => port.row)) * rowHeight + 40);
  const position = (id: string): [number, number] => {
    if (positions[id]) return positions[id];
    const index = Math.max(0, graph.nodes.findIndex((node) => node.id === id));
    let y = 60;
    for (let row = 0; row < Math.floor(index / 2); row++) y += Math.max(...graph.nodes.slice(row*2, row*2+2).map((node) => nodeHeight(node.id))) + 80;
    return [graph.nodes.length === 1 ? (width-nodeWidth)/2 : 60 + (index % 2)*420, y];
  };
  const endpoint = (id: string, ref: string) => {
    const [x, y] = position(id);
    const entry = entries.get(id)?.find((item) => item.ref === ref);
    return { x: x + (entry?.side === "left" ? -stub : nodeWidth+stub), y: y+portStart+(entry?.row ?? 0)*rowHeight, side: entry?.side ?? "right", nodeX: x, nodeY: y };
  };
  const connected = (ref: string, port: GraphPort) => Boolean(port.connections?.length || graph.edges.some((edge) => edge.members.includes(ref)));
  const height = Math.max(380, ...graph.nodes.map((node) => position(node.id)[1]+nodeHeight(node.id)+60));
  const coords = (event: React.PointerEvent) => {
    const point = svg.current!.createSVGPoint();
    point.x = event.clientX; point.y = event.clientY;
    return point.matrixTransform(svg.current!.getScreenCTM()!.inverse());
  };
  return <div className="topology-panel">
    <div className="engine-toolbar"><span>{t("接口沿元件边缘排列，可点击查看详情")}</span>
      <select aria-label={t("关系图层")} value={filter} onChange={(event) => setFilter(event.target.value)}>
        <option value="all">{t("全部关系")}</option><option value="electrical">{t("电路与能源")}</option>
        <option value="material">{t("物料")}</option><option value="information">{t("信息")}</option>
      </select><button onClick={() => setPositions({})}>{t("整理图布局")}</button>
    </div>
    <div className="port-legend"><span><i className="port-legend-dot connected" />{t("已声明项目接线")}</span><span><i className="port-legend-dot" />{t("未声明项目接线")}</span><span>{Object.keys(graph.ports).length} {t("个接口")}</span></div>
    <div className="topology-scroll"><svg ref={svg} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t("实体关系图")}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const point = coords(event), d = drag.current;
        setPositions((old) => ({ ...old, [d.id]: [Math.max(40, Math.min(width-nodeWidth-40, point.x-d.dx)), Math.max(60, point.y-d.dy)] }));
      }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <defs>{Object.entries(colors).map(([key, color]) => <marker key={key} id={`${markerId}-arrow-${key}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={color} /></marker>)}</defs>
      {graph.edges.filter((edge) => filter === "all" || edge.domain === filter).map((edge, edgeIndex) => {
        const points = edge.endpoints.map((item) => endpoint(item.node, item.port));
        if (!points.length) return null;
        const center = { x: graph.nodes.length === 1 ? width-40 : width/2, y: points.reduce((sum, point) => sum+point.y, 0)/points.length };
        return <g key={edge.id} tabIndex={0} role="button" aria-label={edge.id}
          onFocus={() => onHover([edge.id])} onBlur={() => onHover([])} onMouseEnter={() => onHover([edge.id])} onMouseLeave={() => onHover([])}
          onClick={() => onSelect(edge.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(edge.id); } }}>
          <title>{edge.id} · {edge.kind}</title>
          {points.map((point, index) => {
            const outer = point.side === "left" ? point.nodeX < width/2 : point.nodeX+nodeWidth > width/2;
            const rail = point.side === "left" ? 20 : width-20;
            const top = point.nodeY-18-(edgeIndex%4)*6;
            const path = outer ? `M ${point.x} ${point.y} H ${rail} V ${top} H ${center.x} V ${center.y}`
              : `M ${point.x} ${point.y} C ${center.x} ${point.y} ${center.x} ${center.y} ${center.x} ${center.y}`;
            return <path key={index} d={path} fill="none" stroke={colors[edge.domain]} strokeWidth={selected === edge.id ? 4 : 2}
              strokeLinejoin="round" strokeDasharray={edge.domain === "information" ? "6 4" : undefined}
              markerStart={edge.directed && index > 0 ? `url(#${markerId}-arrow-${edge.domain})` : undefined} />;
          })}
          <circle cx={center.x} cy={center.y} r="5" fill={colors[edge.domain]} />
          <text x={center.x+8} y={center.y-8} className="graph-net-label">{edge.id.replace(/^nets\//, "")}</text>
        </g>;
      })}
      {graph.nodes.map((node) => {
        const [x, y] = position(node.id), ports = entries.get(node.id) ?? [];
        return <g key={node.id} transform={`translate(${x} ${y})`} className={`graph-node ${selected === node.id ? "selected" : ""} ${node.missing ? "missing" : ""}`}
          tabIndex={0} role="button" aria-label={node.label} data-entity-ref={node.id}
          onFocus={() => onHover(node.refs)} onBlur={() => onHover([])} onMouseEnter={() => onHover(node.refs)} onMouseLeave={() => onHover([])}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(node.id); } }}
          onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); const point = coords(event); drag.current = { id: node.id, dx: point.x-x, dy: point.y-y }; onSelect(node.id); }}>
          <rect className="graph-node-frame" width={nodeWidth} height={nodeHeight(node.id)} rx="10" />
          <text x="14" y="20" className="graph-entity-key">{short(node.id, 38)}</text>
          <text x="14" y="40" className="graph-node-title">{short(node.label, 38)}</text>
          <line className="graph-node-divider" x1="14" x2={nodeWidth-14} y1="53" y2="53" />
          <title>{node.label} · {node.id}</title>
          {!ports.length && <text x={nodeWidth/2} y="88" textAnchor="middle" className="graph-empty-ports">{t("未定义电路接口")}</text>}
          {ports.map(({ ref, port, side, row }) => {
            const left = side === "left", pinX = left ? -stub : nodeWidth+stub, pinY = portStart+row*rowHeight;
            const isConnected = connected(ref, port);
            const label = `${port.physical_pin_number ? port.physical_pin_number+" · " : ""}${port.name || ref.split("/").pop()}`;
            return <g key={ref} className={`graph-port ${selected === ref ? "selected" : ""}`} role="button" tabIndex={0}
              aria-label={ref} aria-pressed={selected === ref} data-port-ref={ref} data-side={side} data-connected={isConnected}
              onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onSelect(ref); }}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); onSelect(ref); } }}
              onMouseEnter={(event) => { event.stopPropagation(); onHover([ref]); }} onMouseLeave={() => onHover(node.refs)}
              onFocus={(event) => { event.stopPropagation(); onHover([ref]); }} onBlur={() => onHover([])}>
              <line className="graph-pin-stub" x1={left ? 0 : nodeWidth} x2={pinX} y1={pinY} y2={pinY} stroke={colors[port.domain]} />
              <circle className="graph-pin-hit" cx={pinX} cy={pinY} r="12" />
              <circle className="graph-pin-dot" cx={pinX} cy={pinY} r="5" stroke={colors[port.domain]} fill={isConnected ? colors[port.domain] : "#fff"} />
              <text x={left ? 12 : nodeWidth-12} y={pinY+4} textAnchor={left ? "start" : "end"} className="graph-port-label">{short(label, 19)}{samples[ref] !== undefined ? ` = ${String(samples[ref]).slice(0, 12)}` : ""}</text>
              <title>{ref}{port.physical_pin_number ? ` · 脚号 ${port.physical_pin_number}` : ""} · {port.role || port.direction} · {isConnected ? t("已声明项目接线") : t("未声明项目接线")}</title>
            </g>;
          })}
        </g>;
      })}
    </svg></div>
    <small>{t("接口位置为示意排列；连线仅表示声明关系，不表示实际导通。")}</small>
  </div>;
}
