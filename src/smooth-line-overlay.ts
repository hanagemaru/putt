import * as THREE from 'three';

/**
 * 3Dシーンのドット化とは別に、補助線とRESULT軌跡だけを高解像度Canvasで重ねる表示。
 * 軌跡点そのものは変えず、Canvasのアンチエイリアスで滑らかに見せる。
 * 打ち出し方向ガイドは地面に寝た線として見えやすいよう、手前を太く・濃く、先端を細く・薄くする。
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
    if (aimVisible) this.drawTaperedGuide(camera, aimPositions);
    if (trailVisible && trailCount > 1) {
      this.drawPath(camera, trailPositions, trailCount, this.trailColor);
    }
  }

  /**
   * 50cmガイドは近端→遠端の順で入っている。
   * 画面上で台形にして、先端へ向かって幅と透明度を落とすことで遠近感を出す。
   */
  private drawTaperedGuide(camera: THREE.PerspectiveCamera, positions: Float32Array): void {
    const a = this.projectPoint(camera, positions, 0);
    const b = this.projectPoint(camera, positions, 1);
    if (!a || !b) return;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.5) return;

    const nx = -dy / length;
    const ny = dx / length;
    const startHalf = this.widthPx;
    const endHalf = Math.max(0.25, this.widthPx * 0.2);

    const ctx = this.ctx;
    const gradient = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    gradient.addColorStop(0, this.rgba(this.aimColor, Math.min(1, this.opacity * 1.15)));
    gradient.addColorStop(1, this.rgba(this.aimColor, Math.max(0.04, this.opacity * 0.12)));

    ctx.save();
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(a.x + nx * startHalf, a.y + ny * startHalf);
    ctx.lineTo(b.x + nx * endHalf, b.y + ny * endHalf);
    ctx.lineTo(b.x - nx * endHalf, b.y - ny * endHalf);
    ctx.lineTo(a.x - nx * startHalf, a.y - ny * startHalf);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
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
      const point = this.projectPoint(camera, positions, i);
      if (!point) {
        drawing = false;
        continue;
      }

      if (!drawing) {
        ctx.moveTo(point.x, point.y);
        drawing = true;
      } else {
        ctx.lineTo(point.x, point.y);
      }
    }

    ctx.stroke();
    ctx.restore();
  }

  private projectPoint(
    camera: THREE.PerspectiveCamera,
    positions: Float32Array,
    index: number,
  ): { x: number; y: number } | null {
    this.tmp
      .set(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2])
      .project(camera);
    if (this.tmp.z < -1 || this.tmp.z > 1) return null;
    return {
      x: (this.tmp.x * 0.5 + 0.5) * this.cssWidth,
      y: (-this.tmp.y * 0.5 + 0.5) * this.cssHeight,
    };
  }

  private rgba(color: number, alpha: number): string {
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
}
