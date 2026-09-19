'use client';
import { Card } from '@/components/ui/card';
import { CatalogButton } from '@/components/catalog';
import { useEffect, useRef, useState } from 'react';
import { Box, RotateCcw } from 'lucide-react';
import type { Scene } from '@/lib/api';
// Small dependency-free point-cloud renderer: all coordinates come from reconstruction data.
export function SceneView({ scene, at }: { scene: Scene; at: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [rotation, setRotation] = useState(-0.5);
  const [zoom, setZoom] = useState(1);
  const drag = useRef<number | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !scene.available) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const render = () => {
      const w = canvas.clientWidth,
        h = canvas.clientHeight,
        dpr = window.devicePixelRatio || 1;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = '#111710';
      ctx.fillRect(0, 0, w, h);
      const points = scene.points;
      let center = [0, 0, 0];
      for (const p of points) {
        center[0] += p[0];
        center[1] += p[1];
        center[2] += p[2];
      }
      center = center.map((n) => n / Math.max(points.length, 1));
      let extent = 1;
      for (const p of points)
        extent = Math.max(
          extent,
          Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]),
        );
      const project = (p: number[]) => {
        const x = p[0] - center[0],
          y = p[1] - center[1],
          z = p[2] - center[2];
        const xx = x * Math.cos(rotation) + z * Math.sin(rotation),
          zz = -x * Math.sin(rotation) + z * Math.cos(rotation);
        return [
          w / 2 + (xx / extent) * w * 0.38 * zoom,
          h / 2 + ((y * 0.82 - zz * 0.35) / extent) * w * 0.38 * zoom,
          zz,
        ];
      };
      for (const p of [...points].sort(
        (a, b) => project(a)[2] - project(b)[2],
      )) {
        const [x, y] = project(p);
        ctx.fillStyle = `rgb(${p[3] ?? 160},${p[4] ?? 190},${p[5] ?? 140})`;
        ctx.fillRect(x, y, 2, 2);
      }
      for (const m of scene.markers || []) {
        if (m.captured_at > at) continue;
        const [x, y] = project(m.position);
        ctx.fillStyle = '#c5f68a';
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = '14px Arial';
        ctx.fillText(m.label, x + 8, y - 6);
      }
    };
    render();
    const obs = new ResizeObserver(render);
    obs.observe(canvas);
    return () => obs.disconnect();
  }, [scene, rotation, zoom, at]);
  if (!scene.available)
    return (
      <Card className="scene-empty">
        <Box size={42} />
        <h3>No scene yet</h3>
        <p>
          Your reconstructed surroundings appear here after a scan is processed
          on the ASUS computer.
        </p>
        <span>Record a slow, overlapping sweep of a mostly static scene.</span>
      </Card>
    );
  return (
    <div className="point-scene">
      <canvas
        ref={ref}
        aria-label="Reconstructed point cloud. Drag to rotate; use zoom buttons."
        onPointerDown={(e) => {
          drag.current = e.clientX;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current !== null) {
            setRotation((r) => r + (e.clientX - drag.current!) * 0.01);
            drag.current = e.clientX;
          }
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      />
      <div className="scene-tools">
        <CatalogButton
          className="quiet"
          onClick={() => setZoom((v) => Math.min(4, v + 0.2))}
          aria-label="Zoom in"
        >
          +
        </CatalogButton>
        <CatalogButton
          className="quiet"
          onClick={() => setZoom((v) => Math.max(0.2, v - 0.2))}
          aria-label="Zoom out"
        >
          −
        </CatalogButton>
        <CatalogButton
          className="quiet"
          onClick={() => {
            setRotation(-0.5);
            setZoom(1);
          }}
          aria-label="Reset view"
        >
          <RotateCcw size={16} />
        </CatalogButton>
      </div>
      <small className="scene-caption">
        {scene.points.length.toLocaleString()} reconstructed points · positions
        are estimates
      </small>
    </div>
  );
}
