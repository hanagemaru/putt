import * as THREE from 'three';

/**
 * 3Dシーンのドット化とは別に、補助線とRESULT軌跡だけを高解像度Canvasで重ねる比較用表示。
 * 軌跡点そのものは変えず、Canvasのアンチエイリアスで滑らかに見せる。
 */
export class SmoothLineOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tmp = new THREE.Vector3();
  private cssWidth = 1;
  private cssHeight = 1;

  constructor(
    parent: HTMLElement,
    private readonly aimColor: number,
    private readonly trailColor: number,
    private readonly opacity: number,
    private readonly widthPx: number,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    Object.assign(this.canvas.style, {
      position: 'fixed',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '9',
    });
    parent.appendChild(this.canvas);

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available');
    this.ctx = ctx;
  }

  resize(width: number, height: number): void {
    this.cssWidth = Math.max(1, width);
    this.cssHeight = Math.max(1, height);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.max(1, Math.round(this.cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(this.cssHeight * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
  }

  draw(
    camera: THREE.PerspectiveCamera,
    aimPositions: Float32Array,
    aimVisible: boolean,
    trailPositions: Float32Array,
    trailCount: number,
    trailVisible: boolean,
  ): void {
    this.clear();
    if (aimVisible) this.drawPath(camera, aimPositions, 2, this.aimColor);
    if (trailVisible && trailCount > 1) {
      this.drawPath(camera, trailPositions, trailCount, this.trailColor);
    }
  }

  private drawPath(
    camera: THREE.PerspectiveCamera,
    positions: Float32Array,
    count: number,
    color: number,
  ): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = this.opacity;
    ctx.strokeStyle = new THREE.Color(color).getStyle();
    ctx.lineWidth = this.widthPx;
    ctx.beginPath();

    let drawing = false;
    for (let i = 0; i < count; i++) {
      this.tmp
        .set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
        .project(camera);

      // カメラの前にあり、クリップ範囲付近にある点だけをつなぐ。
      const visible = this.tmp.z >= -1 && this.tmp.z <= 1;
      if (!visible) {
        drawing = false;
        continue;
      }

      const x = (this.tmp.x * 0.5 + 0.5) * this.cssWidth;
      const y = (-this.tmp.y * 0.5 + 0.5) * this.cssHeight;
      if (!drawing) {
        ctx.moveTo(x, y);
        drawing = true;
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();
    ctx.restore();
  }
}
