// A small drawing pen for the station's line art. It collects straight line
// segments (with an optional offset and vertical mirror) and turns them into
// one fat-line object, so each part of the drawing is a single draw call.

import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

export type Plane = 'xy' | 'xz' | 'yz';

export class Pen {
  points: number[] = [];
  private ox = 0;
  private oy = 0;
  private oz = 0;
  private sy = 1;

  /** Draw from here on relative to (x, y, z); mirror = -1 flips it upside down. */
  at(x: number, y: number, z: number, mirror = 1): this {
    this.ox = x;
    this.oy = y;
    this.oz = z;
    this.sy = mirror;
    return this;
  }

  seg(ax: number, ay: number, az: number, bx: number, by: number, bz: number): this {
    this.points.push(this.ox + ax, this.oy + ay * this.sy, this.oz + az, this.ox + bx, this.oy + by * this.sy, this.oz + bz);
    return this;
  }

  /** A path through [x, y, z] points; closed joins the last back to the first. */
  path(points: [number, number, number][], closed = false): this {
    for (let i = 0; i < points.length - (closed ? 0 : 1); i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      this.seg(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
    return this;
  }

  /** An upright rectangle facing the viewer, at depth z. */
  rectXY(x0: number, y0: number, x1: number, y1: number, z: number): this {
    return this.path([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], true);
  }

  /** A flat rectangle (a floor or a table top) at height y. */
  rectXZ(x0: number, z0: number, x1: number, z1: number, y: number): this {
    return this.path([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], true);
  }

  /** A rectangle on an end wall, at position x along the station. */
  rectYZ(y0: number, z0: number, y1: number, z1: number, x: number): this {
    return this.path([[x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1]], true);
  }

  /** The twelve edges of a box from one corner to the opposite one. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): this {
    this.rectXY(x0, y0, x1, y1, z0).rectXY(x0, y0, x1, y1, z1);
    return this.seg(x0, y0, z0, x0, y0, z1).seg(x1, y0, z0, x1, y0, z1).seg(x1, y1, z0, x1, y1, z1).seg(x0, y1, z0, x0, y1, z1);
  }

  /** A circle (or an arc from a0 to a1 radians) in one of the three planes. */
  circle(cx: number, cy: number, cz: number, r: number, plane: Plane, steps = 18, a0 = 0, a1 = Math.PI * 2): this {
    const at = (a: number): [number, number, number] => {
      const u = Math.cos(a) * r;
      const v = Math.sin(a) * r;
      return plane === 'xy' ? [cx + u, cy + v, cz] : plane === 'xz' ? [cx + u, cy, cz + v] : [cx, cy + u, cz + v];
    };
    for (let i = 0; i < steps; i++) {
      const a = at(a0 + ((a1 - a0) * i) / steps);
      const b = at(a0 + ((a1 - a0) * (i + 1)) / steps);
      this.seg(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
    return this;
  }

  /** Everything drawn so far, as one fat-line object. */
  lines(material: LineMaterial): LineSegments2 {
    return new LineSegments2(this.geometry(), material);
  }

  /** Everything drawn so far, as a geometry that several line objects can share. */
  geometry(): LineSegmentsGeometry {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(this.points);
    this.points = [];
    return geometry;
  }
}
