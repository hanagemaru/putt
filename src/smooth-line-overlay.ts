import * as THREE from 'three';

/** OB境界を高解像度Canvasへ描くときの見た目 */
export interface ObBoundaryOverlay {
  /** 線分の端点。3つで1点、2点で1本 */
  points: Float32Array;
  /** 線が乗っている地面のおおよその高さ [m]。距離の薄まりを画面の縦位置へ置き換えるのに使う */
  groundY: number;
  color: number;
  widthPx: number;
  opacity: number;
  farOpacity: number;
  fadeNear: number;
  fadeFar: number;
  /** マップ表示中は距離で薄くしない */
  mapMode: boolean;
}

/** 画面上でガイドを隠すボールの円。中心と半径は CSS px */
export interface BallOccluder {
  x: number;
  y: number;
  radius: number;
}

/**
 * 3Dシーンのドット化とは別に、補助線とRESULT軌跡だけを高解像度Canvasで重ねる表示。
 * 軌跡点そのものは変えず、Canvasのアンチエイリアスで滑らかに見せる。
 * 打ち出し方向ガイドは地面に寝た線として見えやすいよう、手前を太く・濃く、先端を細く・薄くする。
 */
export class SmoothLineOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly cameraTmp = new THREE.Vector3();
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

  /** ガイドを隠す円（＝画面上のボール）。中心と半径は px */
  draw(
    camera: THREE.PerspectiveCamera,
    aimPositions: Float32Array,
    aimVisible: boolean,
    trailPositions: Float32Array,
    trailCount: number,
    trailVisible: boolean,
    guideOccluder: BallOccluder | null = null,
    obBoundary: ObBoundaryOverlay | null = null,
  ): void {
    this.clear();
    // OB境界は補助線より下に敷く
    if (obBoundary) this.drawObBoundary(camera, obBoundary);
    if (aimVisible) this.drawTaperedGuide(camera, aimPositions, guideOccluder);
    if (trailVisible && trailCount > 1) {
      this.drawPath(camera, trailPositions, trailCount, this.trailColor);
    }
  }

  /**
   * OB境界。
   *
   * 3Dのドット化とは別にこの高解像度Canvasへ描くので**なめらかに出る**代わりに、
   * このCanvasは深度を持てないので**地形にも木にも隠れない**。
   * 距離で薄くすることで、遠くの線が主張しすぎないようにしている。
   *
   * **線分をまとめて1回で stroke する。** 半透明の線を2回に分けて描くと、
   * 隣り合う線分の丸い端が重なったところだけ濃くなり、**一定間隔の点に見える**
   * （実機で指摘。以前は濃さを8段に丸めて段ごとに stroke していたので、
   * 段の変わり目に点が出ていた）。1回の stroke なら、線分が重なっても濃さは変わらない。
   *
   * 距離による薄まりは、**画面の縦方向のグラデーション**に置き換えて表す。
   * 線は地面に乗っているので、遠いほど画面の上に来る。
   * 段に丸める必要がなくなるので、薄まり方もなめらかになる
   */
  private drawObBoundary(camera: THREE.PerspectiveCamera, ob: ObBoundaryOverlay): void {
    const segments = ob.points.length / 6;
    if (segments === 0) return;

    const path = new Path2D();
    let drew = false;
    for (let s = 0; s < segments; s++) {
      const a = this.projectPoint(camera, ob.points, s * 2);
      const b = this.projectPoint(camera, ob.points, s * 2 + 1);
      if (!a || !b) continue;
      path.moveTo(a.x, a.y);
      path.lineTo(b.x, b.y);
      drew = true;
    }
    if (!drew) return;

    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = this.obStrokeStyle(camera, ob);
    ctx.lineWidth = ob.widthPx;
    ctx.stroke(path);
    ctx.restore();
  }

  /**
   * OB境界の塗り。距離の薄まりを画面の縦方向のグラデーションで表す。
   *
   * 地面の上で `fadeNear` / `fadeFar` の位置が画面のどこに来るかを1回だけ測り、
   * その間を繋ぐ。**真下を向いている間**（打った直後のプレイヤー視点）は
   * 手前も奥も同じ距離なので、グラデーションにせず一様に描く
   */
  private obStrokeStyle(
    camera: THREE.PerspectiveCamera,
    ob: ObBoundaryOverlay,
  ): string | CanvasGradient {
    // マップは図として読むところなので薄めない
    if (ob.mapMode) return this.rgba(ob.color, ob.opacity);

    camera.getWorldPosition(this.cameraTmp);
    camera.getWorldDirection(this.tmp);
    const forward = Math.hypot(this.tmp.x, this.tmp.z);
    if (forward > 0.001) {
      const fx = this.tmp.x / forward;
      const fz = this.tmp.z / forward;
      const near = this.projectWorld(
        camera,
        this.cameraTmp.x + fx * ob.fadeNear,
        ob.groundY,
        this.cameraTmp.z + fz * ob.fadeNear,
      );
      const far = this.projectWorld(
        camera,
        this.cameraTmp.x + fx * ob.fadeFar,
        ob.groundY,
        this.cameraTmp.z + fz * ob.fadeFar,
      );
      if (near && far && Math.abs(near.y - far.y) >= 1) {
        const gradient = this.ctx.createLinearGradient(0, near.y, 0, far.y);
        gradient.addColorStop(0, this.rgba(ob.color, ob.opacity));
        gradient.addColorStop(1, this.rgba(ob.color, ob.farOpacity));
        return gradient;
      }
    }
    return this.rgba(ob.color, ob.opacity);
  }

  /**
   * 50cmガイドは近端→遠端の順で入っている。
   * 画面上で台形にして、先端へ向かって幅と透明度を落とすことで遠近感を出す。
   *
   * ガイドはボールの向こう側にあるので、ボールに隠れなければならない。
   * この Canvas は WebGL の上に重ねていて深度を持てないため、
   * 画面上のボールの円をクリップから抜いて「ボールより下のレイヤー」を作る。
   */
  private drawTaperedGuide(
    camera: THREE.PerspectiveCamera,
    positions: Float32Array,
    occluder: BallOccluder | null,
  ): void {
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
    if (occluder && occluder.radius > 0) {
      // 画面全体からボールの円をくり抜いた領域だけに描く（even-odd）
      ctx.beginPath();
      ctx.rect(0, 0, this.cssWidth, this.cssHeight);
      ctx.arc(occluder.x, occluder.y, occluder.radius, 0, Math.PI * 2);
      ctx.clip('evenodd');
    }
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

  /** ワールド座標1点を画面の CSS px へ。カメラの後ろなら null */
  private projectWorld(
    camera: THREE.PerspectiveCamera,
    x: number,
    y: number,
    z: number,
  ): { x: number; y: number } | null {
    this.tmp2.set(x, y, z).project(camera);
    if (this.tmp2.z < -1 || this.tmp2.z > 1) return null;
    return {
      x: (this.tmp2.x * 0.5 + 0.5) * this.cssWidth,
      y: (-this.tmp2.y * 0.5 + 0.5) * this.cssHeight,
    };
  }

  private rgba(color: number, alpha: number): string {
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
}
