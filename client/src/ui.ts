import { findNearbyLoot } from '../../shared/loot.js';
import { HOTBAR_SLOTS, MAX_INVENTORY_SLOTS } from '../../shared/constants.js';
import { ITEMS, RECIPES, countItemInInventory, type BuildKind, type InvItem, type ItemId } from '../../shared/items.js';
import type { ClientMsg, LootView, NetPlayer, SnapPayload } from '../../shared/protocol.js';
import type { TownLayout } from '../../shared/worldgen.js';

const ITEM_ICONS: Record<ItemId, string> = {
  baseball_bat: '🏏',
  crowbar: '🔧',
  axe: '🪓',
  knife: '🔪',
  pistol: '🔫',
  shotgun: '💥',
  ammo_9mm: '🔸',
  ammo_12g: '🟥',
  canned_food: '🥫',
  chips: '🍟',
  water_bottle: '💧',
  soda: '🥤',
  bandage: '🩹',
  medkit: '🏥',
  antibiotics: '💊',
  wood_plank: '🪵',
  nails: '📌',
  scrap_metal: '⚙️',
  rag: '🧻',
  battery: '🔋',
  flashlight: '🔦',
};

export interface UiHandlers {
  onLoot: (request: Extract<ClientMsg, {t: 'loot'}>) => void;
  onCloseLoot: () => void;
  onSelectSlot: (slot: number) => void;
  onUseItem: (slot: number) => void;
  onDropItem: (slot: number) => void;
  onCraft: (recipeId: string) => void;
  onBuild: (kind: BuildKind) => void;
  onToggleFlash: () => void;
  onToggleSneak: () => void;
  onManualSave: () => void;
  onEmote: (e: 1 | 2 | 3 | 4 | 5 | 6) => void;
  onRespawn: () => void;
  onLeave: () => void;
  onRetry: () => void;
}

export class GameUi {
  private inventory: InvItem[] = [];
  private currentLoot: LootView | null = null;
  private lastLootSig = '';
  private readonly lootPanel = document.getElementById('loot-panel')!;
  private activeSlot = 0;
  private lastInvSig = '';
  private lastMoodleSig = '';
  private lastBuildSig = '';

  private readonly hudVitals = document.getElementById('hud-vitals')!;
  private readonly hudTopRight = document.getElementById('hud-top-right')!;
  private readonly hudBottom = document.getElementById('hud-bottom')!;
  private readonly bagPanel = document.getElementById('bag-panel')!;
  private readonly buildPanel = document.getElementById('build-panel')!;
  private readonly helpPanel = document.getElementById('help-panel')!;
  private readonly emoteWheel = document.getElementById('emote-wheel')!;
  private readonly statusOverlay = document.getElementById('status-overlay')!;
  private readonly statusText = document.getElementById('status-text')!;
  private readonly deathOverlay = document.getElementById('death-overlay')!;
  private readonly promptEl = document.getElementById('interact-prompt')!;
  private readonly toastFeed = document.getElementById('toast-feed')!;
  private readonly savePill = document.getElementById('hud-save-status')!;

  constructor(private readonly h: UiHandlers) {
    document.getElementById('close-loot')?.addEventListener('click', () => this.closeLoot());
    document.getElementById('loot-take-all')?.addEventListener('click', () => {
      if (this.currentLoot?.remaining === 0) this.h.onLoot({t: 'loot', source: this.currentLoot.id, mode: 'all'});
    });
    document.getElementById('btn-flash')?.addEventListener('click', () => this.h.onToggleFlash());
    document.getElementById('btn-sneak')?.addEventListener('click', () => this.h.onToggleSneak());
    document.getElementById('btn-drop')?.addEventListener('click', () => this.h.onDropItem(this.activeSlot));
    document.getElementById('btn-bag')?.addEventListener('click', () => this.togglePanel('bag'));
    document.getElementById('btn-build')?.addEventListener('click', () => this.togglePanel('build'));
    document.getElementById('btn-help')?.addEventListener('click', () => this.togglePanel('help'));
    document.getElementById('btn-emote')?.addEventListener('click', () => this.emoteWheel.classList.toggle('hidden'));
    document.getElementById('close-bag')?.addEventListener('click', () => this.bagPanel.classList.add('hidden'));
    document.getElementById('close-build')?.addEventListener('click', () => this.buildPanel.classList.add('hidden'));
    document.getElementById('close-help')?.addEventListener('click', () => this.helpPanel.classList.add('hidden'));
    document.getElementById('btn-save')?.addEventListener('click', () => this.h.onManualSave());
    document.getElementById('btn-leave')?.addEventListener('click', () => this.h.onLeave());
    document.getElementById('btn-overlay-leave')?.addEventListener('click', () => this.h.onLeave());
    document.getElementById('btn-overlay-retry')?.addEventListener('click', () => this.h.onRetry());
    document.getElementById('btn-respawn')?.addEventListener('click', () => this.h.onRespawn());

    this.emoteWheel.querySelectorAll<HTMLButtonElement>('.emote-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        const e = Number(btn.dataset.e) as 1 | 2 | 3 | 4 | 5 | 6;
        this.h.onEmote(e);
        this.emoteWheel.classList.add('hidden');
      });
    });
  }

  showLoading(text: string) {
    this.renderLoot(null);
    this.statusOverlay.classList.remove('hidden');
    this.statusText.textContent = text;
    document.getElementById('btn-overlay-leave')?.classList.add('hidden');
    document.getElementById('btn-overlay-retry')?.classList.add('hidden');
  }

  showFatalError(text: string, allowRetry = false) {
    this.renderLoot(null);
    this.statusOverlay.classList.remove('hidden');
    this.statusText.textContent = text;
    document.getElementById('btn-overlay-leave')?.classList.remove('hidden');
    document.getElementById('btn-overlay-retry')?.classList.toggle('hidden', !allowRetry);
  }

  hideOverlay() {
    this.statusOverlay.classList.add('hidden');
    this.hudVitals.classList.remove('hidden');
    this.hudTopRight.classList.remove('hidden');
    this.hudBottom.classList.remove('hidden');
  }

  togglePanel(which: 'bag' | 'build' | 'help' | 'emote') {
    if (this.currentLoot) this.closeLoot();
    if (which === 'emote') {
      this.emoteWheel.classList.toggle('hidden');
      return;
    }
    const target = which === 'bag' ? this.bagPanel : which === 'build' ? this.buildPanel : this.helpPanel;
    const willOpen = target.classList.contains('hidden');
    this.bagPanel.classList.add('hidden');
    this.buildPanel.classList.add('hidden');
    this.helpPanel.classList.add('hidden');
    if (willOpen) {
      target.classList.remove('hidden');
      this.renderBuildList(true);
      this.renderBagAndHotbar(true);
    }
  }

  pushToast(msg: string) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    this.toastFeed.appendChild(el);
    setTimeout(() => el.remove(), 3300);
  }

  setPing(ms: number) {
    const el = document.getElementById('hud-ping');
    if (el) el.textContent = `${ms} ms`;
  }

  setSavedAt(at: number) {
    const d = new Date(at);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    this.savePill.textContent = `Saved ${hh}:${mm}`;
  }

  updateFromSnap(snap: SnapPayload, localId: number, town: TownLayout | null) {
    if (snap.inv) {
      this.inventory = snap.inv;
    }

    const me = snap.p.find((p) => p.id === localId);
    if (!me) return;

    this.activeSlot = me.sl;

    // Clock
    const dayEl = document.getElementById('hud-day');
    const timeEl = document.getElementById('hud-time');
    if (dayEl) dayEl.textContent = `Day ${snap.dy}`;
    if (timeEl) {
      const mins = Math.floor(snap.wt);
      const hh = String(Math.floor(mins / 60) % 24).padStart(2, '0');
      const mm = String(mins % 60).padStart(2, '0');
      timeEl.textContent = `${hh}:${mm}`;
    }

    // Vitals
    document.getElementById('hud-player-name')!.textContent = me.n;
    document.getElementById('hud-kills')!.textContent = `${me.kl} Kills`;
    (document.getElementById('bar-hp') as HTMLElement).style.width = `${me.hp}%`;
    (document.getElementById('bar-st') as HTMLElement).style.width = `${me.st}%`;
    (document.getElementById('bar-hu') as HTMLElement).style.width = `${me.hu}%`;
    (document.getElementById('bar-th') as HTMLElement).style.width = `${me.th}%`;

    document.getElementById('flash-pct')!.textContent = `${me.bt}%`;
    document.getElementById('btn-flash')?.classList.toggle('on', me.fl);
    document.getElementById('btn-sneak')?.classList.toggle('on', me.sn);

    this.deathOverlay.classList.toggle('hidden', !me.dd);

    this.renderMoodles(me);
    this.renderBagAndHotbar(false);
    this.renderBuildList(false);
    this.renderLoot(snap.loot ?? null);
    this.updateInteractPrompt(me, snap, town);
  }

  private renderMoodles(me: NetPlayer) {
    const moodles: Array<{ text: string; warn?: boolean }> = [];
    if (me.bl > 0) moodles.push({ text: `🩸 Bleeding x${me.bl}` });
    if (me.inf > 0) moodles.push({ text: '🤢 Queasy' });
    if (me.hu < 30) moodles.push({ text: '🍖 Hungry', warn: true });
    if (me.th < 30) moodles.push({ text: '💧 Thirsty', warn: true });
    if (me.st < 25) moodles.push({ text: '😮‍💨 Exhausted', warn: true });
    if (me.pa > 45) moodles.push({ text: '😱 Panicked', warn: true });

    const sig = moodles.map((m) => m.text).join('|');
    if (sig === this.lastMoodleSig) return;
    this.lastMoodleSig = sig;

    const el = document.getElementById('hud-moodles')!;
    el.innerHTML = moodles
      .map((m) => `<span class="moodle${m.warn ? ' warn' : ''}">${m.text}</span>`)
      .join('');
  }

  private renderBagAndHotbar(force: boolean) {
    const sig = `${this.activeSlot}|` + this.inventory.map((i) => `${i.id}:${i.qty}:${i.dur ?? ''}`).join(',');
    if (!force && sig === this.lastInvSig) return;
    this.lastInvSig = sig;

    const hotbarEl = document.getElementById('hotbar')!;
    hotbarEl.innerHTML = '';
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const item = this.inventory[i];
      const slot = document.createElement('div');
      slot.className = `hot-slot${i === this.activeSlot ? ' active' : ''}`;
      slot.innerHTML = `<span class="hot-key">${i + 1}</span>`;
      if (item) {
        const def = ITEMS[item.id];
        slot.innerHTML += `<span class="hot-icon">${ITEM_ICONS[item.id]}</span><span class="hot-name">${def.name}</span>`;
        if (item.qty > 1) slot.innerHTML += `<span class="hot-qty">x${item.qty}</span>`;
        else if (item.dur !== undefined && def.maxDur) {
          const pct = Math.round((item.dur / def.maxDur) * 100);
          slot.innerHTML += `<span class="hot-qty">${pct}%</span>`;
        }
      }
      slot.addEventListener('click', () => {
        if (item && (ITEMS[item.id].category === 'food' || ITEMS[item.id].category === 'drink' || ITEMS[item.id].category === 'medical' || item.id === 'battery')) {
          this.h.onUseItem(i);
        } else {
          this.h.onSelectSlot(i);
        }
      });
      hotbarEl.appendChild(slot);
    }

    if (!this.bagPanel.classList.contains('hidden')) {
      document.getElementById('bag-count')!.textContent = `${this.inventory.length}/${MAX_INVENTORY_SLOTS}`;
      const grid = document.getElementById('bag-grid')!;
      grid.innerHTML = '';
      this.inventory.forEach((item, idx) => {
        const def = ITEMS[item.id];
        const card = document.createElement('div');
        card.className = 'bag-item';
        card.innerHTML = `
          <button class="drop-x" title="Drop">✕</button>
          <div class="hot-icon">${ITEM_ICONS[item.id]}</div>
          <div class="hot-name" style="max-width:100%;margin-top:3px;">${def.name}</div>
          <div style="font-size:10px;color:#ffd97d;">${item.qty > 1 ? `x${item.qty}` : item.dur !== undefined ? `Dur ${item.dur}` : ''}</div>
        `;
        card.querySelector('.drop-x')?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.h.onDropItem(idx);
        });
        card.addEventListener('click', () => this.h.onUseItem(idx));
        card.addEventListener('contextmenu', (ev) => {
          ev.preventDefault();
          this.h.onDropItem(idx);
        });
        grid.appendChild(card);
      });
    }
  }

  private renderBuildList(force: boolean) {
    if (this.buildPanel.classList.contains('hidden')) return;
    const sig = this.inventory.map((i) => `${i.id}:${i.qty}`).join(',');
    if (!force && sig === this.lastBuildSig) return;
    this.lastBuildSig = sig;

    const list = document.getElementById('build-list')!;
    list.innerHTML = '';
    for (const r of RECIPES) {
      const canCraft = r.inputs.every((req) => countItemInInventory(this.inventory, req.id) >= req.qty);
      const reqStr = r.inputs
        .map((req) => `${ITEMS[req.id].name} (${countItemInInventory(this.inventory, req.id)}/${req.qty})`)
        .join(' · ');

      const row = document.createElement('div');
      row.className = 'build-row';
      row.innerHTML = `
        <div class="build-info">
          <b>${r.label}</b>
          <div class="build-req">${reqStr}</div>
        </div>
        <button class="mini-btn"${canCraft ? '' : ' disabled style="opacity:0.4;cursor:not-allowed;"'}>${r.buildKind ? 'Place' : 'Craft'}</button>
      `;
      row.querySelector('button')?.addEventListener('click', () => {
        if (!canCraft) return;
        if (r.buildKind) this.h.onBuild(r.buildKind);
        else this.h.onCraft(r.id);
      });
      list.appendChild(row);
    }
  }

  getActiveSlot(): number {
    return this.activeSlot;
  }

  closeLoot() {
    this.h.onCloseLoot();
    this.renderLoot(null);
  }

  private renderLoot(loot: LootView | null) {
    const opening = loot && !this.currentLoot;
    this.currentLoot = loot;
    this.lootPanel.classList.toggle('hidden', !loot);
    if (!loot) { this.lastLootSig = ''; return; }
    if (opening) {
      this.bagPanel.classList.add('hidden');
      this.buildPanel.classList.add('hidden');
      this.helpPanel.classList.add('hidden');
    }
    document.getElementById('loot-title')!.textContent = loot.name;
    const searching = loot.remaining > 0;
    document.getElementById('loot-search')!.classList.toggle('hidden', !searching);
    document.getElementById('loot-ready')!.classList.toggle('hidden', searching);
    document.getElementById('loot-time')!.textContent = `${loot.remaining.toFixed(1)}s`;
    (document.getElementById('loot-progress') as HTMLProgressElement).value = loot.duration ? (1 - loot.remaining / loot.duration) * 100 : 100;
    document.getElementById('loot-bag-count')!.textContent = `${this.inventory.length} / ${MAX_INVENTORY_SLOTS} slots`;
    const signature = JSON.stringify([loot.id, searching, loot.items, this.inventory]);
    if (signature === this.lastLootSig) return;
    this.lastLootSig = signature;
    const list = document.getElementById('loot-items')!;
    list.replaceChildren();
    const items = loot.items ?? [];
    document.getElementById('loot-count')!.textContent = `${items.length} item types`;
    document.getElementById('loot-empty')!.classList.toggle('hidden', items.length > 0);
    (document.getElementById('loot-take-all') as HTMLButtonElement).disabled = !items.length || searching;
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'loot-row';
      const icon = document.createElement('span'); icon.className = 'loot-icon'; icon.textContent = ITEM_ICONS[item.id];
      const info = document.createElement('div'); info.className = 'loot-info';
      const name = document.createElement('strong'); name.textContent = ITEMS[item.id].name;
      const meta = document.createElement('small');
      meta.textContent = `×${item.qty}` + (item.dur !== undefined ? ` · Condition ${Math.round(item.dur / (ITEMS[item.id].maxDur ?? item.dur) * 100)}%` : '');
      info.append(name, meta);
      const actions = document.createElement('div'); actions.className = 'loot-row-actions';
      for (const mode of item.qty > 1 ? ['one', 'stack'] as const : ['one'] as const) {
        const button = document.createElement('button'); button.className = 'mini-btn';
        button.textContent = mode === 'one' ? 'Take 1' : 'Take stack';
        button.setAttribute('aria-label', `${button.textContent} ${ITEMS[item.id].name}`);
        button.addEventListener('click', () => this.h.onLoot({t: 'loot', source: loot.id, mode, item: item.id, ...(item.dur !== undefined ? {dur: item.dur} : {})}));
        actions.append(button);
      }
      row.append(icon, info, actions); list.append(row);
    }
    const preview = document.getElementById('loot-bag-preview')!;
    preview.replaceChildren();
    if (!this.inventory.length) preview.textContent = 'Your backpack is empty.';
    for (const item of this.inventory) {
      const chip = document.createElement('span');
      chip.className = 'loot-bag-chip'; chip.title = ITEMS[item.id].name;
      chip.textContent = `${ITEM_ICONS[item.id]} ${ITEMS[item.id].name} ×${item.qty}`;
      preview.append(chip);
    }
  }

  private updateInteractPrompt(me: NetPlayer, snap: SnapPayload, town: TownLayout | null) {
    if (me.dd || this.currentLoot || !town) {
      this.promptEl.classList.add('hidden');
      return;
    }
    const target = findNearbyLoot(town, snap.d, me);
    if (!target) { this.promptEl.classList.add('hidden'); return; }
    const state = snap.c.find(c => c.id === target.id);
    const action = target.kind === 'ground' ? 'Inspect' : state ? 'Open' : 'Search';
    this.promptEl.textContent = `[E] ${action} ${target.name}${state?.lt ? ' (Empty)' : ''}`;
    this.promptEl.classList.remove('hidden');
  }
}
