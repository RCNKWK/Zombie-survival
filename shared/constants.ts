export const WORLD_SIZE = 480;
export const TILE_SIZE = 2;
export const GRID_DIM = WORLD_SIZE / TILE_SIZE;

export const TICK_RATE = 20;
export const TICK_DT = 1 / TICK_RATE;
export const INTEREST_RADIUS = 42;

export const SAVE_MAX_BYTES = 256 * 1024;
export const SAVE_WARN_BYTES = 150 * 1024;
export const MIN_SAVE_INTERVAL_MS = 10_000;
export const AUTOSAVE_DEFAULT_MS = 45_000;
export const RECONNECT_GRACE_DEFAULT_MS = 20_000;
export const WORLD_POLL_DEFAULT_MS = 45_000;

export const MAX_MSG_PER_SEC = 30;
export const MAX_WS_PAYLOAD = 4096;
export const MAX_INVENTORY_SLOTS = 16;
export const HOTBAR_SLOTS = 4;

export const MAX_DROPPED_LOOT = 500;
export const MAX_BARRICADES = 250;
export const MAX_ZOMBIES = 180;
export const INITIAL_GROUND_DROPS = 24;

export const DAY_MINUTES = 1440;
export const GAME_MINUTES_PER_REAL_SEC = 4; // 6 real minutes per full 24h day
export const CONTAINER_RESTOCK_DAYS = 2;

export const PLAYER_RADIUS = 0.42;
export const ZOMBIE_RADIUS = 0.42;

export const PLAYER_WALK_SPEED = 4.8;
export const PLAYER_SPRINT_SPEED = 7.6;
export const PLAYER_SNEAK_SPEED = 2.7;

export const VISION_RANGE_DAY = 24;
export const VISION_RANGE_NIGHT = 9.5;
export const FLASHLIGHT_RANGE = 22;
export const VISION_HALF_ANGLE = 1.05; // ~120 deg total cone

export const SAFE_SPAWN_X = 110;
export const SAFE_SPAWN_Y = 134;

export const EMOTE_IDS = [1, 2, 3, 4, 5, 6] as const;
export type EmoteId = (typeof EMOTE_IDS)[number];
