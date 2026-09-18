import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { api, ApiError } from "../lib/api";
import { ErrorBanner, EmptyState, LoadingBlock } from "../components/Feedback";

interface ConceptNode {
  concept_id: string;
  name: string;
  mastery: number;
  trend: string;
  attempts: number;
}

interface ConceptEdge {
  source: string;
  target: string;
  weight: number;
}

interface ConceptMap {
  nodes: ConceptNode[];
  edges: ConceptEdge[];
}

type Point = { x: number; y: number };

function masteryColor(mastery: number): string {
  if (mastery >= 0.7) return "#16C784";
  if (mastery >= 0.4) return "#FF9F1C";
  return "#FF4D6D";
}

function trendLabel(trend: string): string {
  if (trend === "needs-attention") return "Needs attention";
  if (trend === "improving") return "Improving";
  if (trend === "stable") return "Stable";
  return trend;
}

function nodeRadius(attempts: number): number {
  return 14 + Math.min(attempts, 10) * 1.6;
}

const LEGEND = [
  { color: "#16C784", label: "Strong (≥70%)" },
  { color: "#FF9F1C", label: "Developing (40–69%)" },
  { color: "#FF4D6D", label: "Weak (<40%)" },
];

// Estimated glyph width for a 12px label, used only to space nodes so labels don't crowd each other.
const CHAR_WIDTH = 6.5;

// The pannable/zoomable canvas (the SVG's viewBox) is deliberately larger than
// the content's own tightly-fit bounding box. Without this slack, the visible
// "window" and the content box are the same size, so panning — or even just
// zooming in, which scales content away from its own center — immediately
// pushes edge nodes past the clip boundary (the bug this fixes: nodes
// vanishing when dragged, especially toward the right/bottom).
const CANVAS_PADDING_FACTOR = 1.6;
const MAX_ZOOM = 3;
const MIN_ZOOM = 0.4;

/** Clamps a pan offset on one axis so the content stays fully on-screen
 * whenever the current zoom level leaves room to do so (i.e. up to
 * CANVAS_PADDING_FACTOR), and otherwise falls back to keeping the content's
 * own center reachable so panning can always bring it back into view. */
function clampPanAxis(pan: number, zoom: number, contentHalf: number, viewportHalf: number): number {
  const fullyVisibleLimit = viewportHalf - zoom * contentHalf;
  const limit = fullyVisibleLimit >= 0 ? fullyVisibleLimit : viewportHalf;
  return Math.min(limit, Math.max(-limit, pan));
}

interface SimNode extends SimulationNodeDatum {
  id: string;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  weight: number;
}

/**
 * Force-directed layout (d3-force): unrelated concepts repel apart, related concepts
 * are pulled together with strength proportional to how often they co-occur, and a
 * collide force (sized to each node's label footprint) keeps nodes/labels from overlapping.
 * Run synchronously for a fixed number of ticks so it's deterministic and settles before render.
 */
function simulateForceLayout(
  nodeIds: string[],
  edges: ConceptEdge[],
  effectiveRadius: Map<string, number>
): Map<string, Point> {
  const n = nodeIds.length;
  const initRadius = Math.max(40, Math.sqrt(n) * 30);
  const simNodes: SimNode[] = nodeIds.map((id, i) => {
    const angle = (2 * Math.PI * i) / n;
    return { id, x: initRadius * Math.cos(angle), y: initRadius * Math.sin(angle) };
  });
  const simLinks: SimLink[] = edges.map((edge) => ({ source: edge.source, target: edge.target, weight: edge.weight }));

  const avgRadius = nodeIds.reduce((sum, id) => sum + (effectiveRadius.get(id) ?? 20), 0) / Math.max(1, n);

  const sim = forceSimulation<SimNode>(simNodes)
    .force("charge", forceManyBody().strength(-avgRadius * 7))
    .force(
      "link",
      forceLink<SimNode, SimLink>(simLinks)
        .id((node) => node.id)
        .distance(avgRadius * 2.4)
        .strength((link) => Math.min(1, 0.15 + link.weight * 0.12))
    )
    .force(
      "collide",
      forceCollide<SimNode>((node) => effectiveRadius.get(node.id) ?? 20).strength(0.9)
    )
    .force("x", forceX(0).strength(0.03))
    .force("y", forceY(0).strength(0.03))
    .stop();

  const iterations = Math.min(400, 150 + n * 6);
  for (let i = 0; i < iterations; i++) sim.tick();

  const positions = new Map<string, Point>();
  simNodes.forEach((node) => positions.set(node.id, { x: node.x ?? 0, y: node.y ?? 0 }));
  return positions;
}

/** Compact grid used when there is no relationship data to drive a force layout. */
function layoutGrid(nodeIds: string[], effectiveRadius: Map<string, number>): Map<string, Point> {
  const n = nodeIds.length;
  const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.3)));
  const maxR = Math.max(...nodeIds.map((id) => effectiveRadius.get(id) ?? 20));
  const cellSize = maxR * 2 + 28;
  const positions = new Map<string, Point>();
  nodeIds.forEach((id, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    positions.set(id, { x: col * cellSize, y: row * cellSize });
  });
  return positions;
}

/** Post-process pass that nudges any still-overlapping nodes (and their labels) apart. */
function resolveCollisions(nodeIds: string[], positions: Map<string, Point>, effectiveRadius: Map<string, number>) {
  const padding = 6;
  for (let iter = 0; iter < 40; iter++) {
    let moved = false;
    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = i + 1; j < nodeIds.length; j++) {
        const a = nodeIds[i];
        const b = nodeIds[j];
        const pa = positions.get(a)!;
        const pb = positions.get(b)!;
        const minDist = (effectiveRadius.get(a) ?? 20) + (effectiveRadius.get(b) ?? 20) + padding;
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        if (dist < minDist) {
          moved = true;
          const overlap = (minDist - dist) / 2;
          const ox = (dx / dist) * overlap;
          const oy = (dy / dist) * overlap;
          pa.x -= ox;
          pa.y -= oy;
          pb.x += ox;
          pb.y += oy;
        }
      }
    }
    if (!moved) break;
  }
}

export default function ConceptMapPage() {
  const { projectId } = useParams();
  const [data, setData] = useState<ConceptMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [overrides, setOverrides] = useState<Record<string, Point>>({});

  const svgRef = useRef<SVGSVGElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const dragInfo = useRef<{
    mode: "pan" | "node";
    nodeId?: string;
    startVB: Point;
    startClient: Point;
    startValue: Point;
  } | null>(null);
  const movedRef = useRef(false);

  useEffect(() => {
    if (!projectId) return;
    api
      .get<ConceptMap>(`/api/projects/${projectId}/concepts/map`)
      .then((result) => {
        setData(result);
        setOverrides({});
        setSelectedId(null);
        setView({ x: 0, y: 0, k: 1 });
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the concept map."));
  }, [projectId]);

  const graph = useMemo(() => {
    if (!data || data.nodes.length === 0) return null;
    const nodes = data.nodes;
    const nodeIds = nodes.map((node) => node.concept_id);
    const nodeById = new Map(nodes.map((node) => [node.concept_id, node]));
    const validEdges = data.edges.filter(
      (edge) => nodeById.has(edge.source) && nodeById.has(edge.target) && edge.source !== edge.target
    );

    const effectiveRadius = new Map<string, number>();
    nodes.forEach((node) => {
      const r = nodeRadius(node.attempts);
      const labelHalf = (node.name.length * CHAR_WIDTH) / 2;
      effectiveRadius.set(node.concept_id, Math.max(r, labelHalf) + 8);
    });

    const positions =
      validEdges.length > 0 && nodeIds.length > 1
        ? simulateForceLayout(nodeIds, validEdges, effectiveRadius)
        : layoutGrid(nodeIds, effectiveRadius);
    resolveCollisions(nodeIds, positions, effectiveRadius);

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    nodeIds.forEach((id) => {
      const p = positions.get(id)!;
      const r = effectiveRadius.get(id) ?? 20;
      minX = Math.min(minX, p.x - r);
      maxX = Math.max(maxX, p.x + r);
      minY = Math.min(minY, p.y - r - 18);
      maxY = Math.max(maxY, p.y + r + 32);
    });
    if (nodeIds.length === 1) {
      minX = -90;
      maxX = 90;
      minY = -70;
      maxY = 70;
    }

    const margin = 26;
    const contentWidth = maxX - minX + margin * 2;
    const contentHeight = maxY - minY + margin * 2;
    const width = Math.max(340, contentWidth);
    const height = Math.max(240, contentHeight);
    const offsetX = width / 2 - (minX + maxX) / 2;
    const offsetY = height / 2 - (minY + maxY) / 2;

    const finalPositions = new Map<string, Point>();
    nodeIds.forEach((id) => {
      const p = positions.get(id)!;
      finalPositions.set(id, { x: p.x + offsetX, y: p.y + offsetY });
    });

    const neighborsById = new Map<string, Set<string>>();
    nodeIds.forEach((id) => neighborsById.set(id, new Set()));
    validEdges.forEach((edge) => {
      neighborsById.get(edge.source)?.add(edge.target);
      neighborsById.get(edge.target)?.add(edge.source);
    });

    return {
      width,
      height,
      canvasWidth: width * CANVAS_PADDING_FACTOR,
      canvasHeight: height * CANVAS_PADDING_FACTOR,
      positions: finalPositions,
      nodeById,
      edges: validEdges,
      neighborsById,
    };
  }, [data]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = -e.deltaY * 0.0012;
      setView((v) => {
        const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * (1 + delta)));
        if (!graph) return { ...v, k };
        return {
          k,
          x: clampPanAxis(v.x, k, graph.width / 2, graph.canvasWidth / 2),
          y: clampPanAxis(v.y, k, graph.height / 2, graph.canvasHeight / 2),
        };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [graph]);

  function toViewboxPoint(clientX: number, clientY: number): Point {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    try {
      const pt = svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return { x: 0, y: 0 };
      const p = pt.matrixTransform(ctm.inverse());
      return { x: p.x, y: p.y };
    } catch {
      return { x: 0, y: 0 };
    }
  }

  function handleBackgroundPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragInfo.current = {
      mode: "pan",
      startVB: toViewboxPoint(e.clientX, e.clientY),
      startClient: { x: e.clientX, y: e.clientY },
      startValue: { x: view.x, y: view.y },
    };
    movedRef.current = false;
  }

  function handleNodePointerDown(e: React.PointerEvent, nodeId: string) {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const current = overrides[nodeId] ?? graph?.positions.get(nodeId) ?? { x: 0, y: 0 };
    dragInfo.current = {
      mode: "node",
      nodeId,
      startVB: toViewboxPoint(e.clientX, e.clientY),
      startClient: { x: e.clientX, y: e.clientY },
      startValue: current,
    };
    movedRef.current = false;
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const drag = dragInfo.current;
    if (!drag) return;
    if (Math.abs(e.clientX - drag.startClient.x) > 3 || Math.abs(e.clientY - drag.startClient.y) > 3) {
      movedRef.current = true;
    }
    const cur = toViewboxPoint(e.clientX, e.clientY);
    const dxVB = cur.x - drag.startVB.x;
    const dyVB = cur.y - drag.startVB.y;

    if (drag.mode === "pan" && graph) {
      // Clamped so the whole graph stays on-screen whenever the current zoom
      // leaves room for that; past that zoom level, at least its center stays
      // reachable so it can always be panned back into view.
      const nextX = clampPanAxis(drag.startValue.x + dxVB, view.k, graph.width / 2, graph.canvasWidth / 2);
      const nextY = clampPanAxis(drag.startValue.y + dyVB, view.k, graph.height / 2, graph.canvasHeight / 2);
      setView((v) => ({ ...v, x: nextX, y: nextY }));
    } else if (drag.mode === "node" && drag.nodeId) {
      const dx = dxVB / view.k;
      const dy = dyVB / view.k;
      const nodeId = drag.nodeId;
      setOverrides((prev) => ({ ...prev, [nodeId]: { x: drag.startValue.x + dx, y: drag.startValue.y + dy } }));
    }
  }

  function handlePointerUp() {
    const drag = dragInfo.current;
    dragInfo.current = null;
    if (!drag) return;
    if (!movedRef.current) {
      if (drag.mode === "node" && drag.nodeId) {
        const nodeId = drag.nodeId;
        setSelectedId((cur) => (cur === nodeId ? null : nodeId));
      } else if (drag.mode === "pan") {
        setSelectedId(null);
      }
    }
    movedRef.current = false;
  }

  function zoomBy(factor: number) {
    setView((v) => {
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * factor));
      if (!graph) return { ...v, k };
      return {
        k,
        x: clampPanAxis(v.x, k, graph.width / 2, graph.canvasWidth / 2),
        y: clampPanAxis(v.y, k, graph.height / 2, graph.canvasHeight / 2),
      };
    });
  }

  function resetView() {
    setView({ x: 0, y: 0, k: 1 });
    setOverrides({});
    setSelectedId(null);
  }

  if (!projectId) return null;

  const activeId = hoveredId ?? selectedId;
  const selectedNode = selectedId && graph ? graph.nodeById.get(selectedId) ?? null : null;
  const relatedNames =
    selectedId && graph
      ? Array.from(graph.neighborsById.get(selectedId) ?? [])
          .map((id) => graph.nodeById.get(id)?.name)
          .filter((name): name is string => Boolean(name))
      : [];

  return (
    <div className="page">
      <div className="crumb">
        <Link to={`/projects/${projectId}`} style={{ color: "inherit" }}>← Project</Link>
      </div>
      <h1 className="h-disp" style={{ fontSize: 26, marginBottom: 20 }}>Concept Map</h1>

      {error && <ErrorBanner message={error} />}

      {!data && !error && (
        <div className="card">
          <LoadingBlock />
        </div>
      )}

      {data && data.nodes.length === 0 && (
        <EmptyState
          title="No concepts yet"
          hint="Complete some learning activities to build your concept map."
        />
      )}

      {data && data.nodes.length > 0 && graph && (
        <div className="block">
          <div className="legend">
            {LEGEND.map((item) => (
              <span key={item.label}>
                <span className="dot" style={{ width: 10, height: 10, background: item.color }} />
                {item.label}
              </span>
            ))}
            {graph.edges.length > 0 && <span>Line thickness = how often two concepts appear together</span>}
          </div>

          {graph.edges.length === 0 && (
            <div className="graph-note">
              No relationships detected yet — these concepts haven't appeared together in the same material.
            </div>
          )}

          <div ref={wrapperRef} className="graph" style={{ background: "var(--surface-2)" }}>
            <div className="graph-ctrl">
              <button type="button" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
                +
              </button>
              <button type="button" onClick={() => zoomBy(0.8)} aria-label="Zoom out">
                −
              </button>
              <button type="button" onClick={resetView} style={{ fontSize: 12, fontWeight: 700 }}>
                Reset
              </button>
            </div>

            <svg
              ref={svgRef}
              viewBox={`0 0 ${graph.canvasWidth} ${graph.canvasHeight}`}
              role="img"
              aria-label="Concept map"
              style={{ width: "100%", height: "auto", display: "block", touchAction: "none", cursor: "grab" }}
              onPointerDown={handleBackgroundPointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            >
              <g
                transform={`translate(${graph.canvasWidth / 2 + view.x} ${graph.canvasHeight / 2 + view.y}) scale(${view.k}) translate(${-graph.width / 2} ${-graph.height / 2})`}
              >
                {graph.edges.map((edge, i) => {
                  const from = overrides[edge.source] ?? graph.positions.get(edge.source);
                  const to = overrides[edge.target] ?? graph.positions.get(edge.target);
                  if (!from || !to) return null;
                  const isActive = Boolean(activeId) && (edge.source === activeId || edge.target === activeId);
                  const dimmed = Boolean(activeId) && !isActive;
                  return (
                    <line
                      key={i}
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke={isActive ? "var(--violet)" : "var(--line)"}
                      strokeWidth={Math.min(1 + edge.weight, 6)}
                      strokeLinecap="round"
                      opacity={dimmed ? 0.08 : isActive ? 0.85 : 0.42}
                    />
                  );
                })}
                {data.nodes.map((node) => {
                  const pos = overrides[node.concept_id] ?? graph.positions.get(node.concept_id);
                  if (!pos) return null;
                  const r = nodeRadius(node.attempts);
                  const isActive = activeId === node.concept_id;
                  const isNeighbor = activeId ? graph.neighborsById.get(activeId)?.has(node.concept_id) : false;
                  const dimmed = Boolean(activeId) && !isActive && !isNeighbor;

                  return (
                    <g
                      key={node.concept_id}
                      onPointerDown={(e) => handleNodePointerDown(e, node.concept_id)}
                      onPointerEnter={() => setHoveredId(node.concept_id)}
                      onPointerLeave={() => setHoveredId((cur) => (cur === node.concept_id ? null : cur))}
                      onFocus={() => setHoveredId(node.concept_id)}
                      onBlur={() => setHoveredId((cur) => (cur === node.concept_id ? null : cur))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedId((cur) => (cur === node.concept_id ? null : node.concept_id));
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      aria-label={`${node.name}, mastery ${Math.round(node.mastery * 100)} percent`}
                      style={{ cursor: "pointer", outline: "none" }}
                    >
                      <circle
                        cx={pos.x}
                        cy={pos.y}
                        r={r}
                        fill={masteryColor(node.mastery)}
                        opacity={dimmed ? 0.3 : 1}
                        stroke={isActive ? "var(--violet)" : "#fff"}
                        strokeWidth={isActive ? 3 : 2}
                      />
                      <text
                        x={pos.x}
                        y={pos.y + r + 15}
                        textAnchor="middle"
                        fontSize={12}
                        fontWeight={isActive ? 700 : 500}
                        fill="var(--ink)"
                        stroke="var(--surface-2)"
                        strokeWidth={3}
                        paintOrder="stroke"
                        opacity={dimmed ? 0.4 : 1}
                      >
                        {node.name}
                      </text>
                      {hoveredId === node.concept_id && (
                        <text
                          x={pos.x}
                          y={pos.y - r - 10}
                          textAnchor="middle"
                          fontSize={11}
                          fill="var(--muted)"
                          stroke="var(--surface-2)"
                          strokeWidth={3}
                          paintOrder="stroke"
                        >
                          {Math.round(node.mastery * 100)}% · {trendLabel(node.trend)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>

            {selectedNode && (
              <div
                className="card node-detail-card"
                style={{
                  position: "absolute",
                  top: 10,
                  left: 10,
                  zIndex: 2,
                  width: 220,
                  padding: 16,
                }}
              >
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  aria-label="Close"
                  style={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                    background: "transparent",
                    border: "none",
                    color: "var(--faint)",
                    cursor: "pointer",
                    fontSize: 14,
                    padding: 4,
                  }}
                >
                  ✕
                </button>
                <div style={{ fontWeight: 700, marginBottom: 8, paddingRight: 18 }}>{selectedNode.name}</div>
                <div style={{ fontSize: 13, marginBottom: 10 }}>
                  Mastery: <strong>{Math.round(selectedNode.mastery * 100)}%</strong>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <span className={`badge badge-${selectedNode.trend}`}>{trendLabel(selectedNode.trend)}</span>
                </div>
                <div style={{ fontSize: 12, marginBottom: 8, color: "var(--faint)", fontWeight: 700, textTransform: "uppercase" }}>
                  Related concepts
                </div>
                {relatedNames.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {relatedNames.map((name) => (
                      <span key={name} className="badge b-muted">
                        {name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: "var(--faint)" }}>
                    None detected yet
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ padding: "12px 22px 18px", fontSize: 12.5, color: "var(--faint)" }}>
            Drag nodes to rearrange · scroll or use +/− to zoom · click a node for details
          </div>
        </div>
      )}
    </div>
  );
}
