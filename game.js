/* =========================================================
   TOWER BOX — Stack the Boxes!
   Pure HTML5 Canvas + Web Audio API (no external libraries)
   ========================================================= */

(() => {
'use strict';

// ---------- CANVAS SETUP ----------
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let W = 0, H = 0, DPR = window.devicePixelRatio || 1;

function resize() {
  // Portrait-style game area — fits both desktop & mobile
  const maxW = Math.min(window.innerWidth, 500);
  const maxH = window.innerHeight;
  W = maxW;
  H = maxH;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  canvas.width  = W * DPR;
  canvas.height = H * DPR;
  ctx.setTransform(DPR,0,0,DPR,0,0);
}
window.addEventListener('resize', resize);
resize();

// ---------- AUDIO (Web Audio API generated SFX) ----------
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
let muted = false;

function initAudio() {
  if (!audioCtx) audioCtx = new AudioCtx();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playTone(freq, duration=0.15, type='sine', volume=0.2) {
  if (muted || !audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}
function sfxStack()   { playTone(440, 0.1, 'square', 0.18); }
function sfxPerfect() {
  playTone(660, 0.1, 'triangle', 0.25);
  setTimeout(()=>playTone(880, 0.12, 'triangle', 0.25), 70);
  setTimeout(()=>playTone(1320,0.15, 'triangle', 0.25), 140);
}
function sfxFail() {
  playTone(180, 0.3, 'sawtooth', 0.3);
  setTimeout(()=>playTone(120, 0.4, 'sawtooth', 0.25), 100);
}
function sfxClick() { playTone(800, 0.05, 'square', 0.1); }

// ---------- GAME STATE ----------
const STATE = { MENU:'menu', PLAYING:'playing', OVER:'over', PAUSED:'paused' };
let state = STATE.MENU;

let score = 0, best = parseInt(localStorage.getItem('towerbox_best') || '0');
let combo = 0;
let cameraY = 0; // scroll offset
let particles = [];
let clouds = [];
let raindrops = [];
let stars = [];

// World "altitude" determines what's in the sky
// 0–10 floors  : sunny day
// 10–25 floors : clouds & rainbow
// 25–40 floors : sunset
// 40–60 floors : night with moon & stars
// 60+          : space

let stack = [];          // placed boxes
let movingBox = null;    // current sliding box
let direction = 1;
let speed = 2.5;
const BOX_HEIGHT = 28;
let baseWidth = 220;
let perfectStreak = 0;

// ---------- HELPERS ----------
const $ = id => document.getElementById(id);
const startScreen = $('startScreen');
const gameOverScreen = $('gameOverScreen');
const pauseBtn = $('pauseBtn');

function rand(a,b){ return a + Math.random()*(b-a); }
function clamp(v,a,b){ return Math.max(a, Math.min(b,v)); }
function lerp(a,b,t){ return a+(b-a)*t; }

// ---------- BOX COLOR PALETTE ----------
const palette = [
  ['#FF6B9D','#C41E5E'], ['#5DADE2','#2980B9'],
  ['#F7DC6F','#D4AC0D'], ['#58D68D','#229954'],
  ['#BB8FCE','#7D3C98'], ['#F1948A','#C0392B'],
  ['#85C1E2','#1F618D'], ['#F8C471','#B9770E'],
];
function colorFor(i){ return palette[i % palette.length]; }

// ---------- INIT GAME ----------
function startGame() {
  initAudio();
  state = STATE.PLAYING;
  score = 0; combo = 0; cameraY = 0; perfectStreak = 0;
  stack = [];
  particles = [];
  raindrops = [];

  // Base platform
  const baseX = (W - baseWidth) / 2;
  const baseY = H - 80;
  stack.push({ x: baseX, y: baseY, w: baseWidth, h: BOX_HEIGHT, color: colorFor(0) });

  spawnMovingBox();
  initClouds();
  initStars();
  updateHUD();

  startScreen.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
  pauseBtn.classList.remove('hidden');
}

function spawnMovingBox() {
  const top = stack[stack.length-1];
  const fromLeft = Math.random() < 0.5;
  movingBox = {
    x: fromLeft ? -top.w : W,
    y: top.y - BOX_HEIGHT,
    w: top.w,
    h: BOX_HEIGHT,
    color: colorFor(stack.length),
  };
  direction = fromLeft ? 1 : -1;
  speed = 2.5 + Math.min(stack.length * 0.08, 4); // gradually faster
}

function initClouds() {
  clouds = [];
  for (let i=0;i<6;i++) {
    clouds.push({
      x: rand(0, W),
      y: rand(-200, H-200),
      scale: rand(0.6, 1.2),
      speed: rand(0.1, 0.4),
    });
  }
}
function initStars() {
  stars = [];
  for (let i=0;i<60;i++) {
    stars.push({
      x: rand(0, W),
      y: rand(0, H*3),
      size: rand(0.8, 2.4),
      tw: rand(0, Math.PI*2),
    });
  }
}

// ---------- INPUT ----------
function dropBox() {
  if (state !== STATE.PLAYING || !movingBox) return;
  const top = stack[stack.length-1];
  const overlapStart = Math.max(movingBox.x, top.x);
  const overlapEnd   = Math.min(movingBox.x + movingBox.w, top.x + top.w);
  const overlap = overlapEnd - overlapStart;

  if (overlap <= 0) {
    // Missed entirely
    movingBox.falling = true;
    particles.push(...explode(movingBox.x+movingBox.w/2, movingBox.y+movingBox.h/2, movingBox.color[0], 30));
    sfxFail();
    gameOver();
    return;
  }

  // Perfect-ish detection (within 4px tolerance)
  const offset = Math.abs(movingBox.x - top.x);
  if (offset < 4) {
    // PERFECT! Keep full size + bonus
    movingBox.x = top.x;
    movingBox.w = top.w;
    perfectStreak++;
    combo = perfectStreak;
    score += 5 * combo;
    // Tiny grow-back bonus (like original)
    if (top.w < baseWidth) {
      const grow = Math.min(4, baseWidth - top.w);
      movingBox.w += grow;
      movingBox.x -= grow/2;
    }
    sfxPerfect();
    burstSparkle(movingBox.x+movingBox.w/2, movingBox.y);
  } else {
    // Slice off the overhang
    perfectStreak = 0; combo = 1;
    const cutLeft  = movingBox.x < top.x;
    const newX = Math.max(movingBox.x, top.x);
    const newW = overlap;

    // Falling chunk
    const chunk = {
      x: cutLeft ? movingBox.x : top.x + top.w,
      y: movingBox.y,
      w: movingBox.w - newW,
      h: movingBox.h,
      color: movingBox.color,
      vx: cutLeft ? -2 : 2,
      vy: 0,
      rot: 0, vr: rand(-0.1,0.1),
      falling: true,
    };
    fallingChunks.push(chunk);

    movingBox.x = newX;
    movingBox.w = newW;
    score += 1;
    sfxStack();
  }

  stack.push({...movingBox});
  movingBox = null;

  // Update HUD & camera
  updateHUD();

  // Camera scroll up
  targetCameraY = Math.max(0, (stack.length - 6) * BOX_HEIGHT);

  setTimeout(()=> {
    if (state === STATE.PLAYING) spawnMovingBox();
  }, 120);
}

let fallingChunks = [];
let targetCameraY = 0;

// ---------- PARTICLES ----------
function explode(x,y,color,count=20) {
  const out = [];
  for (let i=0;i<count;i++) {
    out.push({
      x, y,
      vx: rand(-4,4), vy: rand(-6,-1),
      life: 1,
      size: rand(3,7),
      color,
    });
  }
  return out;
}
function burstSparkle(x,y) {
  for (let i=0;i<18;i++) {
    particles.push({
      x, y,
      vx: rand(-3,3), vy: rand(-5,-1),
      life: 1, size: rand(2,5),
      color: ['#FFE066','#FFFFFF','#FFD700'][i%3],
      sparkle: true,
    });
  }
}

// ---------- UPDATE ----------
function update(dt) {
  if (state !== STATE.PLAYING) return;

  // Move active box
  if (movingBox) {
    movingBox.x += direction * speed;
    if (movingBox.x + movingBox.w > W) { movingBox.x = W - movingBox.w; direction = -1; }
    if (movingBox.x < 0) { movingBox.x = 0; direction = 1; }
  }

  // Camera lerp
  cameraY = lerp(cameraY, targetCameraY, 0.08);

  // Clouds drift
  clouds.forEach(c => {
    c.x += c.speed;
    if (c.x > W + 100) { c.x = -100; c.y = rand(-200, H-200); }
  });

  // Particles
  particles = particles.filter(p => p.life > 0);
  particles.forEach(p => {
    p.x += p.vx; p.y += p.vy;
    p.vy += 0.25;
    p.life -= 0.02;
  });

  // Falling chunks
  fallingChunks = fallingChunks.filter(c => c.y < H + 200);
  fallingChunks.forEach(c => {
    c.vy += 0.4;
    c.x += c.vx;
    c.y += c.vy;
    c.rot += c.vr;
  });

  // Spawn rain at high altitude
  const altitude = stack.length;
  if (altitude >= 10 && altitude < 25 && Math.random() < 0.4) {
    raindrops.push({ x: rand(0,W), y: -10, vy: rand(8,14), len: rand(8,16) });
  }
  raindrops = raindrops.filter(r => r.y < H + 20);
  raindrops.forEach(r => r.y += r.vy);
}

// ---------- DRAW ----------
function drawBackground() {
  const altitude = stack.length;
  let topColor, midColor, botColor;

  if (altitude < 10) {
    topColor='#87CEEB'; midColor='#B0E0E6'; botColor='#FFE4B5';
  } else if (altitude < 25) {
    topColor='#5DADE2'; midColor='#85C1E2'; botColor='#D6EAF8';
  } else if (altitude < 40) {
    topColor='#FF6B9D'; midColor='#F8C471'; botColor='#FFE4B5';
  } else if (altitude < 60) {
    topColor='#0d1b3d'; midColor='#1e3a6a'; botColor='#3b5998';
  } else {
    topColor='#000010'; midColor='#0a0a3a'; botColor='#1a0a4a';
  }

  const grad = ctx.createLinearGradient(0,0,0,H);
  grad.addColorStop(0, topColor);
  grad.addColorStop(0.5, midColor);
  grad.addColorStop(1, botColor);
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,W,H);

  // Stars (visible at night)
  if (altitude >= 40) {
    stars.forEach(s => {
      s.tw += 0.05;
      const a = 0.5 + Math.sin(s.tw)*0.5;
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.beginPath();
      ctx.arc(s.x, (s.y - cameraY*0.3) % H, s.size, 0, Math.PI*2);
      ctx.fill();
    });
  }

  // Sun (low altitude)
  if (altitude < 25) {
    drawSun(W - 80, 90 - cameraY*0.1);
  }

  // Moon (high altitude)
  if (altitude >= 40) {
    drawMoon(80, 100);
  }

  // Rainbow at mid altitude
  if (altitude >= 15 && altitude < 30) {
    drawRainbow(W/2, H + 50, 280);
  }

  // Clouds
  clouds.forEach(c => drawCloud(c.x, c.y, c.scale));

  // Rain
  if (raindrops.length) {
    ctx.strokeStyle = 'rgba(180,220,255,0.6)';
    ctx.lineWidth = 2;
    raindrops.forEach(r => {
      ctx.beginPath();
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(r.x-2, r.y + r.len);
      ctx.stroke();
    });
  }
}

function drawSun(x,y) {
  const t = Date.now()/1000;
  // Glow
  const glow = ctx.createRadialGradient(x,y,10, x,y,70);
  glow.addColorStop(0,'rgba(255,220,100,0.8)');
  glow.addColorStop(1,'rgba(255,220,100,0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(x,y,70,0,Math.PI*2); ctx.fill();
  // Body
  ctx.fillStyle = '#FFD93D';
  ctx.beginPath(); ctx.arc(x,y,28,0,Math.PI*2); ctx.fill();
  // Rays
  ctx.strokeStyle = '#FFD93D'; ctx.lineWidth = 4; ctx.lineCap='round';
  for (let i=0;i<8;i++) {
    const a = i*Math.PI/4 + t*0.3;
    ctx.beginPath();
    ctx.moveTo(x+Math.cos(a)*36, y+Math.sin(a)*36);
    ctx.lineTo(x+Math.cos(a)*48, y+Math.sin(a)*48);
    ctx.stroke();
  }
  // Smile
  ctx.fillStyle = '#222';
  ctx.beginPath(); ctx.arc(x-9,y-4,3,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(x+9,y-4,3,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#222'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x,y+4,8,0,Math.PI); ctx.stroke();
}

function drawMoon(x,y) {
  const glow = ctx.createRadialGradient(x,y,10, x,y,60);
  glow.addColorStop(0,'rgba(230,230,255,0.5)');
  glow.addColorStop(1,'rgba(230,230,255,0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(x,y,60,0,Math.PI*2); ctx.fill();
  // Body
  ctx.fillStyle = '#F4F1DE';
  ctx.beginPath(); ctx.arc(x,y,26,0,Math.PI*2); ctx.fill();
  // Crater shadow
  ctx.fillStyle = '#0d1b3d';
  ctx.beginPath(); ctx.arc(x+10,y-3,22,0,Math.PI*2); ctx.fill();
  // Sleepy face
  ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(x-12,y-2); ctx.quadraticCurveTo(x-9,y-5,x-6,y-2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x-3,y-2); ctx.quadraticCurveTo(x,y-5,x+3,y-2); ctx.stroke();
}

function drawRainbow(cx,cy,r) {
  const colors = ['#FF6B9D','#F8C471','#F7DC6F','#58D68D','#5DADE2','#BB8FCE'];
  ctx.lineWidth = 8;
  colors.forEach((c,i) => {
    ctx.strokeStyle = c;
    ctx.beginPath();
    ctx.arc(cx, cy - cameraY*0.05, r - i*9, Math.PI, 0);
    ctx.stroke();
  });
}

function drawCloud(x,y,s=1) {
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  ctx.arc(x, y, 22*s, 0, Math.PI*2);
  ctx.arc(x+22*s, y-6*s, 26*s, 0, Math.PI*2);
  ctx.arc(x+48*s, y, 20*s, 0, Math.PI*2);
  ctx.arc(x+24*s, y+10*s, 22*s, 0, Math.PI*2);
  ctx.fill();
}

function drawBox(b, isTop=false) {
  const y = b.y + cameraY;
  const [light, dark] = b.color;
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(b.x+3, y+3, b.w, b.h);
  // Body gradient
  const g = ctx.createLinearGradient(b.x, y, b.x, y+b.h);
  g.addColorStop(0, light);
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.fillRect(b.x, y, b.w, b.h);
  // Top highlight strip
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillRect(b.x, y, b.w, 4);
  // Outline
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(b.x, y, b.w, b.h);

  if (isTop) {
    // Glow on active box
    ctx.shadowColor = light;
    ctx.shadowBlur = 18;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x+1, y+1, b.w-2, b.h-2);
    ctx.shadowBlur = 0;
  }
}

function drawFallingChunk(c) {
  const y = c.y + cameraY;
  ctx.save();
  ctx.translate(c.x + c.w/2, y + c.h/2);
  ctx.rotate(c.rot);
  const [light, dark] = c.color;
  const g = ctx.createLinearGradient(0,-c.h/2,0,c.h/2);
  g.addColorStop(0,light); g.addColorStop(1,dark);
  ctx.fillStyle = g;
  ctx.fillRect(-c.w/2, -c.h/2, c.w, c.h);
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.strokeRect(-c.w/2, -c.h/2, c.w, c.h);
  ctx.restore();
}

function drawParticles() {
  particles.forEach(p => {
    ctx.globalAlpha = clamp(p.life,0,1);
    ctx.fillStyle = p.color;
    if (p.sparkle) {
      ctx.beginPath();
      ctx.arc(p.x, p.y + cameraY, p.size, 0, Math.PI*2);
      ctx.fill();
    } else {
      ctx.fillRect(p.x, p.y + cameraY, p.size, p.size);
    }
  });
  ctx.globalAlpha = 1;
}

// ---------- MAIN LOOP ----------
let last = performance.now();
function loop(now) {
  const dt = Math.min(33, now - last); last = now;
  update(dt);

  drawBackground();

  // Stack
  stack.forEach(b => drawBox(b, false));
  fallingChunks.forEach(drawFallingChunk);
  if (movingBox) drawBox(movingBox, true);

  drawParticles();

  // Combo flash
  if (combo > 1 && state === STATE.PLAYING) {
    ctx.fillStyle = '#FFE066';
    ctx.font = 'bold 28px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(`PERFECT x${combo}!`, W/2, 70);
  }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------- HUD ----------
function updateHUD() {
  $('score').textContent = score;
  $('best').textContent = best;
  $('combo').textContent = 'x' + Math.max(1,combo);
}

// ---------- GAME OVER ----------
function gameOver() {
  state = STATE.OVER;
  if (score > best) { best = score; localStorage.setItem('towerbox_best', best); }
  $('finalScore').textContent = score;
  $('finalBest').textContent = best;
  $('finalHeight').textContent = stack.length - 1;
  pauseBtn.classList.add('hidden');
  setTimeout(() => gameOverScreen.classList.remove('hidden'), 600);
}

// ---------- EVENTS ----------
function onTap(e) {
  if (e) e.preventDefault();
  if (state === STATE.PLAYING) dropBox();
}
canvas.addEventListener('pointerdown', onTap);
window.addEventListener('keydown', e => {
  if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); onTap(); }
});

$('startBtn').addEventListener('click', () => { sfxClick(); startGame(); });
$('restartBtn').addEventListener('click', () => { sfxClick(); startGame(); });
$('muteBtn').addEventListener('click', e => {
  muted = !muted;
  e.target.textContent = muted ? '🔇 Sound: OFF' : '🔊 Sound: ON';
});
// ---------- PAUSE / RESUME / QUIT ----------
const pauseScreen = $('pauseScreen');

pauseBtn.addEventListener('click', () => {
  if (state === STATE.PLAYING) {
    state = STATE.PAUSED;
    pauseBtn.classList.add('hidden');
    pauseScreen.classList.remove('hidden');
    sfxClick();
  }
});

$('resumeBtn').addEventListener('click', () => {
  sfxClick();
  state = STATE.PLAYING;
  pauseScreen.classList.add('hidden');
  pauseBtn.classList.remove('hidden');
  last = performance.now();
});

$('quitBtn').addEventListener('click', () => {
  sfxClick();
  state = STATE.MENU;
  pauseScreen.classList.add('hidden');
  pauseBtn.classList.add('hidden');
  startScreen.classList.remove('hidden');
  // Reset state visually
  stack = [];
  movingBox = null;
  particles = [];
  fallingChunks = [];
  raindrops = [];
  cameraY = 0; targetCameraY = 0;
  score = 0; combo = 0;
  updateHUD();
});

})();