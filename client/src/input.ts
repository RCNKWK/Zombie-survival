export interface InputHandlers {
  onCloseLoot: () => void;
  onAttack: () => void;
  onShove: () => void;
  onInteract: () => void;
  onDropHeld: () => void;
  onFlashlight: () => void;
  onSelectSlot: (slot: number) => void;
  onToggleBag: () => void;
  onToggleBuild: () => void;
  onToggleEmote: () => void;
  onZoom: (delta: number) => void;
  onFirstGesture: () => void;
  computeAimAngle: (clientX: number, clientY: number) => number | null;
}

export class InputController {
  private keys = new Set<string>();
  private sneakToggle = false;
  private mobileSprint = false;
  private mouseX = window.innerWidth / 2;
  private mouseY = window.innerHeight / 2;
  private lastAngle = 0;

  // Mobile dual-stick state
  private leftStick = { active: false, id: -1, cx: 0, cy: 0, dx: 0, dy: 0 };
  private rightStick = { active: false, id: -1, cx: 0, cy: 0, firing: false, lastShotAt: 0 };
  readonly isTouchDevice: boolean;

  constructor(canvas: HTMLCanvasElement, private readonly h: InputHandlers) {
    this.isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (this.isTouchDevice) {
      document.getElementById('mobile-controls')?.classList.remove('hidden');
    }

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    canvas.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', this.onWheel, { passive: true });

    this.setupMobileSticks();
  }

  private setupMobileSticks() {
    const leftEl = document.getElementById('stick-left');
    const rightEl = document.getElementById('stick-right');
    const leftKnob = leftEl?.querySelector('.stick-knob') as HTMLElement | null;
    const rightKnob = rightEl?.querySelector('.stick-knob') as HTMLElement | null;

    const bindStick = (
      el: HTMLElement | null,
      knob: HTMLElement | null,
      onUpdate: (dx: number, dy: number, active: boolean) => void,
    ) => {
      if (!el) return;
      let touchId = -1;
      const updateFromTouch = (t: Touch) => {
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const maxR = rect.width * 0.38;
        let dx = t.clientX - cx;
        let dy = t.clientY - cy;
        const dist = Math.hypot(dx, dy);
        if (dist > maxR) {
          dx = (dx / dist) * maxR;
          dy = (dy / dist) * maxR;
        }
        if (knob) knob.style.transform = `translate(${dx}px, ${dy}px)`;
        onUpdate(dx / maxR, dy / maxR, true);
      };

      el.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.h.onFirstGesture();
        const t = e.changedTouches[0];
        if (!t) return;
        touchId = t.identifier;
        updateFromTouch(t);
      });
      el.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (const t of Array.from(e.changedTouches)) {
          if (t.identifier === touchId) updateFromTouch(t);
        }
      });
      const end = (e: TouchEvent) => {
        for (const t of Array.from(e.changedTouches)) {
          if (t.identifier === touchId) {
            touchId = -1;
            if (knob) knob.style.transform = 'translate(0px, 0px)';
            onUpdate(0, 0, false);
          }
        }
      };
      el.addEventListener('touchend', end);
      el.addEventListener('touchcancel', end);
    };

    bindStick(leftEl, leftKnob, (dx, dy, active) => {
      this.leftStick.active = active;
      this.leftStick.dx = dx;
      this.leftStick.dy = dy;
    });

    bindStick(rightEl, rightKnob, (dx, dy, active) => {
      this.rightStick.active = active;
      const mag = Math.hypot(dx, dy);
      if (active && mag > 0.2) {
        this.lastAngle = Math.atan2(dy, dx);
      }
      this.rightStick.firing = active && mag > 0.45;
    });

    document.getElementById('m-shove')?.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.h.onFirstGesture();
      this.h.onShove();
    });
    document.getElementById('m-interact')?.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.h.onFirstGesture();
      this.h.onInteract();
    });
    const sprintBtn = document.getElementById('m-sprint');
    sprintBtn?.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.h.onFirstGesture();
      this.mobileSprint = !this.mobileSprint;
      sprintBtn.classList.toggle('on', this.mobileSprint);
    });
  }

  private onKeyDown = (e: KeyboardEvent) => {
    this.h.onFirstGesture();
    const code = e.code;
    // Let focused UI buttons receive their native keyboard activation.
    if ((code === 'Space' || code === 'Enter') && e.target instanceof HTMLElement && e.target.closest('button, input, select, textarea')) return;
    this.keys.add(code);

    if (e.repeat) return;
    if (code === 'Escape') this.h.onCloseLoot();
    else if (code === 'KeyE') this.h.onInteract();
    else if (code === 'KeyQ') this.h.onDropHeld();
    else if (code === 'KeyF') this.h.onFlashlight();
    else if (code === 'KeyC') this.sneakToggle = !this.sneakToggle;
    else if (code === 'Space') {
      e.preventDefault();
      this.h.onShove();
    } else if (code === 'KeyI' || code === 'Tab') {
      e.preventDefault();
      this.h.onToggleBag();
    } else if (code === 'KeyB') this.h.onToggleBuild();
    else if (code === 'KeyT') this.h.onToggleEmote();
    else if (code === 'Digit1') this.h.onSelectSlot(0);
    else if (code === 'Digit2') this.h.onSelectSlot(1);
    else if (code === 'Digit3') this.h.onSelectSlot(2);
    else if (code === 'Digit4') this.h.onSelectSlot(3);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onMouseMove = (e: MouseEvent) => {
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
  };

  private onMouseDown = (e: MouseEvent) => {
    this.h.onFirstGesture();
    if (e.button === 0) this.h.onAttack();
    else if (e.button === 2) this.h.onShove();
  };

  private onWheel = (e: WheelEvent) => {
    this.h.onZoom(e.deltaY > 0 ? 0.08 : -0.08);
  };

  toggleSneak() {
    this.sneakToggle = !this.sneakToggle;
  }

  isSneaking(): boolean {
    return this.sneakToggle;
  }

  pollMoveAndAim(): { dx: number; dy: number; angle: number; sprint: boolean; sneak: boolean } {
    let dx = 0;
    let dy = 0;

    if (this.leftStick.active) {
      dx = this.leftStick.dx;
      dy = this.leftStick.dy;
    } else {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) dy -= 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) dy += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) dx -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) dx += 1;
    }

    if (!this.isTouchDevice) {
      const computed = this.h.computeAimAngle(this.mouseX, this.mouseY);
      if (computed !== null) this.lastAngle = computed;
    } else if (!this.rightStick.active && Math.hypot(dx, dy) > 0.2) {
      this.lastAngle = Math.atan2(dy, dx);
    }

    if (this.rightStick.firing) {
      const now = performance.now();
      if (now - this.rightStick.lastShotAt > 360) {
        this.rightStick.lastShotAt = now;
        this.h.onAttack();
      }
    }

    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.mobileSprint;
    return {
      dx: Math.max(-1, Math.min(1, dx)),
      dy: Math.max(-1, Math.min(1, dy)),
      angle: this.lastAngle,
      sprint,
      sneak: this.sneakToggle,
    };
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }
}
