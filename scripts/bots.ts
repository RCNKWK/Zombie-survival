import WebSocket from 'ws';

const worldId = process.argv[2] ?? 'dev';
const botCount = Math.max(1, Math.min(8, Number(process.argv[3] ?? 2)));
const baseUrl = process.env.WS_URL ?? 'ws://localhost:2567/ws';

console.log(`[bots] spawning ${botCount} survivor bots into world "${worldId}" (${baseUrl})`);

for (let i = 1; i <= botCount; i++) {
  const name = `Bot${i}`;
  const ws = new WebSocket(`${baseUrl}?world=${encodeURIComponent(worldId)}`);
  let angle = (i * Math.PI) / 2;

  ws.on('open', () => {
    ws.send(JSON.stringify({ t: 'join', token: `local:${name}` }));
  });

  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.t === 'welcome') {
      console.log(`[bots] ${name} joined as #${msg.you} (${msg.role})`);
    } else if (msg.t === 'error') {
      console.error(`[bots] ${name} error: ${msg.code} - ${msg.msg}`);
    }
  });

  const timer = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    angle += (Math.random() - 0.5) * 0.5;
    ws.send(
      JSON.stringify({
        t: 'in',
        dx: Math.cos(angle) * 0.7,
        dy: Math.sin(angle) * 0.7,
        a: angle,
        sp: false,
        sn: false,
      }),
    );
    if (Math.random() < 0.15) ws.send(JSON.stringify({ t: 'act', k: 'attack' }));
    if (Math.random() < 0.08) ws.send(JSON.stringify({ t: 'act', k: 'interact' }));
  }, 150);

  ws.on('close', () => {
    clearInterval(timer);
    console.log(`[bots] ${name} disconnected`);
  });
}
