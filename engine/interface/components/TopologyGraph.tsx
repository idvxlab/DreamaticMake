import "./TopologyGraph.css";
import { useRef, useState } from "react";
import type { GraphProjection } from "../contracts";
const identity = (text: string) => text;

const colors = {
  electrical: "#bd8940",
  material: "#348c88",
  information: "#7674bd",
};
export function TopologyGraph({
  graph,
  selected,
  onSelect,
  onHover,
  samples = {},
  translate: t = identity,
}: {
  graph: GraphProjection;
  selected: string;
  onSelect: (ref: string) => void;
  onHover: (refs: string[]) => void;
  samples?: Record<string, unknown>;
  translate?: (text: string) => string;
}) {
  const [positions, setPositions] = useState<Record<string, [number, number]>>(
    {},
  );
  const [filter, setFilter] = useState("all");
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const coords = (event: React.PointerEvent) => {
    const point = svg.current!.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(svg.current!.getScreenCTM()!.inverse());
  };
  const ports = (id: string) =>
    Object.entries(graph.ports).filter(([, p]) => p.entity === id);
  const position = (id: string): [number, number] => {
    if (positions[id]) return positions[id];
    const index = Math.max(
      0,
      graph.nodes.findIndex((n) => n.id === id),
    );
    let y = 40;
    for (let row = 0; row < Math.floor(index / 2); row++)
      y += Math.max(
        145,
        ...graph.nodes
          .slice(row * 2, row * 2 + 2)
          .map((n) => 95 + ports(n.id).length * 20),
      );
    return [25 + (index % 2) * 260, y];
  };
  const endpoint = (id: string, port: string): [number, number] => {
    const [x, y] = position(id),
      index = ports(id).findIndex(([key]) => key === port);
    return [x + 175, y + 42 + Math.max(0, index) * 20];
  };
  const height = Math.max(
    440,
    ...graph.nodes.map((n) => position(n.id)[1] + 85 + ports(n.id).length * 20),
  );
  return (
    <div className="topology-panel">
      <div className="engine-toolbar">
        <span>{t("拖动节点只改变图布局")}</span>
        <select
          aria-label={t("关系图层")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">{t("全部关系")}</option>
          <option value="electrical">{t("电路与能源")}</option>
          <option value="material">{t("物料")}</option>
          <option value="information">{t("信息")}</option>
        </select>
        <button onClick={() => setPositions({})}>{t("整理图布局")}</button>
      </div>
      <div className="topology-scroll">
        <svg
          ref={svg}
          viewBox={`0 0 510 ${height}`}
          role="img"
          aria-label={t("实体关系图")}
          onPointerMove={(e) => {
            if (!drag.current) return;
            const p = coords(e),
              d = drag.current;
            setPositions((old) => ({
              ...old,
              [d.id]: [
                Math.max(0, Math.min(325, p.x - d.dx)),
                Math.max(0, p.y - d.dy),
              ],
            }));
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          <defs>
            {Object.entries(colors).map(([key, color]) => (
              <marker
                key={key}
                id={`arrow-${key}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
              </marker>
            ))}
          </defs>
          {graph.edges
            .filter((edge) => filter === "all" || edge.domain === filter)
            .map((edge) => {
              const points = edge.endpoints.map((e) =>
                endpoint(e.node, e.port),
              );
              const center = [
                points.reduce((s, p) => s + p[0], 0) / points.length + 20,
                points.reduce((s, p) => s + p[1], 0) / points.length,
              ];
              return (
                <g
                  key={edge.id}
                  tabIndex={0}
                  role="button"
                  aria-label={edge.id}
                  onFocus={() => onHover([edge.id])}
                  onBlur={() => onHover([])}
                  onMouseEnter={() => onHover([edge.id])}
                  onMouseLeave={() => onHover([])}
                  onClick={() => onSelect(edge.id)}
                >
                  <title>
                    {edge.id} · {edge.kind}
                  </title>
                  {points.map((p, i) => (
                    <path
                      key={i}
                      d={`M ${p[0]} ${p[1]} Q ${p[0] + 40} ${p[1]} ${center[0]} ${center[1]}`}
                      fill="none"
                      stroke={colors[edge.domain]}
                      strokeWidth={selected === edge.id ? 5 : 2.5}
                      strokeDasharray={
                        edge.domain === "information" ? "6 4" : undefined
                      }
                      markerStart={
                        edge.directed && i > 0
                          ? `url(#arrow-${edge.domain})`
                          : undefined
                      }
                    />
                  ))}
                  <circle
                    cx={center[0]}
                    cy={center[1]}
                    r="6"
                    fill={colors[edge.domain]}
                  />
                  <text x={center[0] + 8} y={center[1] - 8}>
                    {edge.kind}
                  </text>
                </g>
              );
            })}
          {graph.nodes.map((node) => {
            const [x, y] = position(node.id),
              entries = ports(node.id);
            return (
              <g
                key={node.id}
                transform={`translate(${x} ${y})`}
                className={`graph-node ${selected === node.id ? "selected" : ""} ${node.missing ? "missing" : ""}`}
                tabIndex={0}
                role="button"
                aria-label={node.label}
                data-entity-ref={node.id}
                onFocus={() => onHover(node.refs)}
                onBlur={() => onHover([])}
                onMouseEnter={() => onHover(node.refs)}
                onMouseLeave={() => onHover([])}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSelect(node.id);
                }}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const p = coords(e);
                  drag.current = { id: node.id, dx: p.x - x, dy: p.y - y };
                  onSelect(node.id);
                }}
              >
                <rect
                  width="175"
                  height={Math.max(65, 52 + entries.length * 20)}
                  rx="10"
                />
                <text x="12" y="24">
                  {node.label.slice(0, 22)}
                </text>
                <title>
                  {node.label} · {node.id}
                </title>
                {entries.map(([key, port], index) => (
                  <g
                    key={key}
                    role="button"
                    tabIndex={0}
                    aria-label={key}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(key);
                    }}
                    onMouseEnter={(e) => {
                      e.stopPropagation();
                      onHover([key]);
                    }}
                    onMouseLeave={() => onHover(node.refs)}
                    onFocus={() => onHover([key])}
                    onBlur={() => onHover([])}
                  >
                    <text
                      x="12"
                      y={46 + index * 20}
                      className="graph-port-label"
                    >
                      {port.name.slice(0, 21)}
                      {samples[key] !== undefined
                        ? ` = ${String(samples[key]).slice(0, 20)}`
                        : ""}
                    </text>
                    <circle
                      cx="175"
                      cy={42 + index * 20}
                      r="5"
                      fill={colors[port.domain]}
                    />
                    <title>{key}</title>
                  </g>
                ))}
              </g>
            );
          })}
        </svg>
      </div>
      <small>{t("连线只表达声明关系，不表示实际导通或流量。")}</small>
    </div>
  );
}
