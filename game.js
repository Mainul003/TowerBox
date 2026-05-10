/* ===========================================================
   TOWER BOX — Build the Tallest Tower!
   Crane drops floors → stack precisely → grow your skyscraper.
   Pure HTML5 Canvas + Web Audio API.
   =========================================================== */
(() => {
'use strict';

// ----- Canvas -----
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let W=0, H=0, DPR = window.devicePixelRatio || 1;

function resize() {
  W = Math.min(window.innerWidth, 540);
  H = window.innerHeight;
  canvas.style.width = W+'px';
  canvas.style.height = H+'px';
  canvas.width = W*DPR; canvas.height = H*DPR;
  ctx.setTransform(DPR,0,0,DPR,0,0);
}
window.addEventListener('resize', resize); resize();

// ----- Audio -----
const AC = window.AudioContext || window.webkitAudioContext;
let audio=null, muted=false;
function initAudio(){ if(!audio) audio = new AC(); if(audio.state==='suspended') audio.resume(); }
function tone(f,d=0.12,t='sine',v=0.18){
  if(muted||!audio) return;
  const o=audio.createOscillator(), g=audio.createGain();
  o.type=t; o.frequency.value=f;
  g.gain.setValueAtTime(v, audio.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime+d);
  o.connect(g).connect(audio.destination);
  o.start(); o.stop(audio.currentTime+d);
}
const sfxDrop    = ()=> tone(220,0.08,'square',0.15);
const sfxLand    = ()=> { tone(180,0.1,'square',0.2); setTimeout(()=>tone(140,0.12,'square',0.15),80); };
const sfxPerfect = ()=> { tone(660,0.08,'triangle',0.2); setTimeout(()=>tone(880,0.1,'triangle',0.2),60); setTimeout(()=>tone(1320,0.14,'triangle',0.22),130); };
const sfxStar    = ()=> tone(1568,0.18,'triangle',0.22);
const sfxCoin    = ()=> { tone(988,0.06,'square',0.15); setTimeout(()=>tone(1318,0.1,'square',0.15),50); };
const sfxFall    = ()=> { tone(120,0.5,'sawtooth',0.25); };
const sfxClick   = ()=> tone(800,0.04,'square',0.1);

// ----- State -----
const ST = { MENU:'menu', PLAY:'play', OVER:'over', PAUSE:'pause' };
let state = ST.MENU;

let floors=[];           // placed floors (towers)
let movingFloor=null;    // currently swinging on the crane
let fallingPieces=[];    // sliced overhang pieces
let particles=[];
let stars=[];            // collectible stars on screen
let coinsFloat=[];       // floating +coin texts
let blimps=[];
let cloudsArr=[];

let cameraY=0, targetCameraY=0;
let coins = parseInt(localStorage.getItem('tb_coins')||'0');
let starsCollected = 0;
let best = parseInt(localStorage.getItem('tb_best')||'0');

let craneX=0, craneRopeLen=80, craneSwing=0;
let direction=1, speed=2.2;

const FLOOR_H = 44;
const baseW = 150;
let currentW = baseW;

// ----- Helpers -----
const $ = id => document.getElementById(id);
const rand = (a,b)=> a+Math.random()*(b-a);
const clamp = (v,a,b)=> Math.max(a,Math.min(b,v));
const lerp = (a,b,t)=> a+(b-a)*t;

// ----- Floor color palette (warm wooden / colorful blocks) -----
const palette = [
  { body:'#E8A87C', dark:'#C77F4A', accent:'#FFD9A8' },  // tan
  { body:'#85C1E2', dark:'#3498DB', accent:'#D6EAF8' },  // blue
  { body:'#F7DC6F', dark:'#D4AC0D', accent:'#FFF3B0' },  // yellow
  { body:'#82E0AA', dark:'#27AE60', accent:'#D5F5E3' },  // green
  { body:'#F1948A', dark:'#C0392B', accent:'#FADBD8' },  // red
  { body:'#BB8FCE', dark:'#7D3C98', accent:'#E8DAEF' },  // purple
  { body:'#F8B195', dark:'#E07856', accent:'#FCE4D6' },  // peach
];
const floorColor = i => palette[i % palette.length];

// ----- INIT ROUND -----
function startGame() {
  initAudio();
  state = ST.PLAY;
  floors = []; fallingPieces=[]; particles=[]; stars=[]; coinsFloat=[];
  starsCollected = 0;
  cameraY = 0; targetCameraY = 0;
  currentW = baseW;

  // Ground base (wider, sticking out)
  const baseX = (W - 200)/2;
  const baseY = H - 90;
  floors.push({
    x: baseX, y: baseY, w: 200, h: 60,
    color: { body:'#7f8c8d', dark:'#34495e', accent:'#bdc3c7' },
    isBase:true,
  });

  // First building floor on top of base
  const fX = (W - baseW)/2;
  floors.push({
    x: fX, y: baseY - FLOOR_H, w: baseW, h: FLOOR_H,
    color: floorColor(0),
  });

  initSky();
  spawnFloor();
  updateHUD();
  $('startScreen').classList.add('hidden');
  $('gameOverScreen').classList.add('hidden');
  $('pauseScreen').classList.add('hidden');
  $('pauseBtn').classList.remove('hidden');
  $('ghosts').classList.remove('hidden');
}

function initSky() {
  cloudsArr = [];
  for (let i=0;i<8;i++) cloudsArr.push({
    x: rand(-50, W+50),
    y: rand(40, H-200),
    s: rand(0.6, 1.3),
    vx: rand(0.15, 0.45),
  });
  blimps = [];
  for (let i=0;i<2;i++) blimps.push({
    x: rand(-200, W),
    y: rand(80, H/2),
    vx: rand(0.4, 0.8),
    color: ['#FF6B9D','#5DADE2','#F8C471'][i%3],
  });
}

function spawnFloor() {
  const top = floors[floors.length-1];
  // Crane comes from a side and lowers
  craneX = Math.random() < 0.5 ? 40 : W-40;
  direction = craneX < W/2 ? 1 : -1;
  speed = 2 + Math.min(floors.length * 0.06, 3.5);
  movingFloor = {
    x: craneX - currentW/2,
    y: 80,           // hanging at top of screen
    w: currentW,
    h: FLOOR_H,
    color: floorColor(floors.length-1),
    swinging:true,
  };
}

// ----- INPUT: drop floor -----
function dropFloor() {
  if (state !== ST.PLAY || !movingFloor || !movingFloor.swinging) return;
  movingFloor.swinging = false;
  movingFloor.vy = 0;
  sfxDrop();
}

// ----- LANDING LOGIC -----
function onLand() {
  const top = floors[floors.length-1];
  const overlapStart = Math.max(movingFloor.x, top.x);
  const overlapEnd   = Math.min(movingFloor.x+movingFloor.w, top.x+top.w);
  const overlap = overlapEnd - overlapStart;

  if (overlap <= 0) {
    // Total miss → tower falls
    movingFloor.falling = true;
    movingFloor.vy = 2; movingFloor.vx = direction*2; movingFloor.rot=0; movingFloor.vr=rand(-0.08,0.08);
    fallingPieces.push(movingFloor);
    movingFloor = null;
    sfxFall();
    return gameOver();
  }

  const offset = Math.abs(movingFloor.x - top.x);
  if (offset < 5) {
    // PERFECT
    movingFloor.x = top.x;
    movingFloor.w = top.w;
    currentW = top.w;
    sfxPerfect();
    burstSparkle(movingFloor.x+movingFloor.w/2, movingFloor.y);
    // Drop a star above for collection
    stars.push({
      x: movingFloor.x + movingFloor.w/2,
      y: movingFloor.y - 30,
      vy: -1, life: 60,
    });
    coinsFloat.push({ x: movingFloor.x+movingFloor.w/2, y: movingFloor.y-10, text:'+10 🪙', life:60 });
    coins += 10;
    starsCollected += 1;
    sfxStar();
  } else {
    // Slice the overhang
    const cutLeft = movingFloor.x < top.x;
    const newX = Math.max(movingFloor.x, top.x);
    const newW = overlap;

    fallingPieces.push({
      x: cutLeft ? movingFloor.x : top.x+top.w,
      y: movingFloor.y,
      w: movingFloor.w - newW,
      h: movingFloor.h,
      color: movingFloor.color,
      vx: cutLeft ? -2 : 2, vy:0, rot:0, vr:rand(-0.1,0.1),
      falling:true,
    });

    movingFloor.x = newX;
    movingFloor.w = newW;
    currentW = newW;
    sfxLand();
    coins += 1;
    coinsFloat.push({ x: movingFloor.x+movingFloor.w/2, y: movingFloor.y-5, text:'+1', life:50 });
  }

  floors.push({...movingFloor});
  movingFloor = null;
  updateHUD();

  // Camera follows tower up
  const towerTopY = floors[floors.length-1].y;
  targetCameraY = Math.max(0, (H*0.5) - towerTopY);

  if (currentW < 20) return gameOver(); // too thin

  setTimeout(()=>{ if(state===ST.PLAY) spawnFloor(); }, 250);
}

// ----- PARTICLES / EFFECTS -----
function burstSparkle(x,y) {
  for (let i=0;i<22;i++) {
    particles.push({
      x, y,
      vx: rand(-3.5,3.5), vy: rand(-5,-1),
      life: 1, size: rand(2,5),
      color: ['#FFE066','#FFD93D','#FFFFFF','#FFA502'][i%4],
      sparkle:true,
    });
  }
}

// ----- UPDATE -----
function update() {
  if (state !== ST.PLAY) return;

  // Crane sway
  craneSwing += 0.04;

  if (movingFloor) {
    if (movingFloor.swinging) {
      // swing left-right
      movingFloor.x += direction * speed;
      const top = floors[floors.length-1];
      // Bounds: keep above the playable area
      if (movingFloor.x + movingFloor.w > W-10) { movingFloor.x = W-10-movingFloor.w; direction = -1; }
      if (movingFloor.x < 10) { movingFloor.x = 10; direction = 1; }
    } else {
      // Falling onto stack
      movingFloor.vy = (movingFloor.vy||0) + 0.9;
      movingFloor.y += movingFloor.vy;
      const top = floors[floors.length-1];
      if (movingFloor.y + movingFloor.h >= top.y) {
        movingFloor.y = top.y - movingFloor.h;
        onLand();
      }
    }
  }

  // Camera lerp
  cameraY = lerp(cameraY, targetCameraY, 0.08);

  // Clouds + blimps
  cloudsArr.forEach(c => { c.x += c.vx; if (c.x > W+80) { c.x = -80; c.y = rand(40, H-200); } });
  blimps.forEach(b => { b.x += b.vx; if (b.x > W+150) { b.x = -150; b.y = rand(80, H/2); } });

  // Falling pieces gravity
  fallingPieces = fallingPieces.filter(c => c.y < H+300);
  fallingPieces.forEach(c => { c.vy += 0.5; c.x += c.vx; c.y += c.vy; c.rot += c.vr; });

  // Particles
  particles = particles.filter(p => p.life > 0);
  particles.forEach(p => { p.x+=p.vx; p.y+=p.vy; p.vy+=0.25; p.life-=0.02; });

  // Stars (collected as they float up)
  stars = stars.filter(s => s.life > 0);
  stars.forEach(s => { s.y += s.vy; s.life--; });

  // Coin floats
  coinsFloat = coinsFloat.filter(c => c.life > 0);
  coinsFloat.forEach(c => { c.y -= 1.2; c.life--; });
}

// ----- DRAW BACKGROUND (sky + far city) -----
function drawSky() {
  // Sky gradient (light blue, like reference)
  const g = ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,'#7ec8e3');
  g.addColorStop(0.6,'#a8d8ea');
  g.addColorStop(1,'#d4ebf2');
  ctx.fillStyle = g;
  ctx.fillRect(0,0,W,H);

  // Sun in corner
  ctx.fillStyle = 'rgba(255,235,150,0.7)';
  ctx.beginPath(); ctx.arc(W-50, 70, 35, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#FFD93D';
  ctx.beginPath(); ctx.arc(W-50, 70, 22, 0, Math.PI*2); ctx.fill();

  // Clouds
  cloudsArr.forEach(c => drawCloud(c.x, c.y, c.s));

  // Blimps
  blimps.forEach(b => drawBlimp(b.x, b.y, b.color));
}

function drawCloud(x, y, s) {
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x, y, 18*s, 0, Math.PI*2);
  ctx.arc(x+18*s, y-6*s, 22*s, 0, Math.PI*2);
  ctx.arc(x+38*s, y, 17*s, 0, Math.PI*2);
  ctx.arc(x+20*s, y+8*s, 18*s, 0, Math.PI*2);
  ctx.fill();
  ctx.strokeStyle='rgba(80,100,140,0.25)'; ctx.lineWidth=2; ctx.stroke();
}

function drawBlimp(x, y, color) {
  ctx.save();
  ctx.translate(x, y);
  // Body
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0,0,40,14,0,0,Math.PI*2);
  ctx.fill();
  ctx.strokeStyle='#2c3e50'; ctx.lineWidth=2; ctx.stroke();
  // Window strip
  ctx.fillStyle='#fff';
  ctx.fillRect(-20,-2,40,4);
  // Fin
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(38,0); ctx.lineTo(48,-7); ctx.lineTo(48,7); ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Cabin
  ctx.fillStyle='#ecf0f1';
  ctx.fillRect(-8,12,16,5);
  ctx.strokeRect(-8,12,16,5);
  ctx.restore();
}

// ----- DRAW CRANE -----
function drawCrane() {
  if (!movingFloor) return;
  const cx = movingFloor.x + movingFloor.w/2;
  const ropeTopY = 0;
  const ropeBotY = movingFloor.y;
  // Crane arm at top (horizontal beam coming from off-screen)
  ctx.strokeStyle='#2c3e50'; ctx.lineWidth=4;
  ctx.beginPath();
  ctx.moveTo(0, 30); ctx.lineTo(cx+10, 30);
  ctx.stroke();
  // Diagonal support
  ctx.beginPath();
  ctx.moveTo(0, 5); ctx.lineTo(cx+10, 30);
  ctx.stroke();
  // Rope
  ctx.beginPath();
  ctx.moveTo(cx, 30);
  ctx.lineTo(cx, ropeBotY);
  ctx.stroke();
  // Hook block
  ctx.fillStyle='#2c3e50';
  ctx.fillRect(cx-8, ropeBotY-6, 16, 6);
}

// ----- DRAW FLOOR (building floor with windows) -----
function drawFloor(f, isMoving=false) {
  const y = f.y + cameraY;
  if (y > H+100 || y+f.h < -50) return;

  const c = f.color;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(f.x+4, y+4, f.w, f.h);

  // Body gradient
  const g = ctx.createLinearGradient(f.x, y, f.x, y+f.h);
  g.addColorStop(0, c.accent);
  g.addColorStop(0.5, c.body);
  g.addColorStop(1, c.dark);
  ctx.fillStyle = g;
  ctx.fillRect(f.x, y, f.w, f.h);

  if (!f.isBase) {
    // Windows
    const winH = f.h * 0.5;
    const winY = y + (f.h-winH)/2;
    const winW = 18, gap = 8;
    const totalWinSpace = f.w - 16;
    const numWins = Math.max(1, Math.floor(totalWinSpace / (winW+gap)));
    const startX = f.x + (f.w - (numWins*winW + (numWins-1)*gap))/2;
    for (let i=0;i<numWins;i++) {
      const wx = startX + i*(winW+gap);
      // Window frame
      ctx.fillStyle = '#2c3e50';
      ctx.fillRect(wx-1, winY-1, winW+2, winH+2);
      // Glass
      const wg = ctx.createLinearGradient(wx, winY, wx, winY+winH);
      wg.addColorStop(0,'#aee2ff');
      wg.addColorStop(1,'#5dade2');
      ctx.fillStyle = wg;
      ctx.fillRect(wx, winY, winW, winH);
      // Cross
      ctx.strokeStyle = '#2c3e50'; ctx.lineWidth=1.5;
      ctx.beginPath();
      ctx.moveTo(wx+winW/2, winY); ctx.lineTo(wx+winW/2, winY+winH);
      ctx.moveTo(wx, winY+winH/2); ctx.lineTo(wx+winW, winY+winH/2);
      ctx.stroke();
      // Highlight
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillRect(wx+2, winY+2, winW/3, winH/3);
    }
  } else {
    // Base — show "ground" texture
    ctx.fillStyle = '#27ae60';
    ctx.fillRect(f.x, y, f.w, 8);
    // Door
    ctx.fillStyle = '#5d2e0f';
    ctx.fillRect(f.x + f.w/2 - 12, y + 18, 24, 34);
    ctx.fillStyle = '#FFD93D';
    ctx.beginPath(); ctx.arc(f.x + f.w/2 + 6, y + 36, 2, 0, Math.PI*2); ctx.fill();
  }

  // Top edge highlight
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillRect(f.x, y, f.w, 3);

  // Outline
  ctx.strokeStyle = '#2c3e50'; ctx.lineWidth=2;
  ctx.strokeRect(f.x, y, f.w, f.h);

  // Glow if moving
  if (isMoving) {
    ctx.save();
    ctx.shadowColor = '#FFD93D'; ctx.shadowBlur = 18;
    ctx.strokeStyle = 'rgba(255,217,61,0.8)'; ctx.lineWidth=3;
    ctx.strokeRect(f.x+1, y+1, f.w-2, f.h-2);
    ctx.restore();
  }
}

function drawFallingPiece(p) {
  const y = p.y + cameraY;
  ctx.save();
  ctx.translate(p.x+p.w/2, y+p.h/2);
  ctx.rotate(p.rot);
  const g = ctx.createLinearGradient(0,-p.h/2,0,p.h/2);
  g.addColorStop(0, p.color.accent); g.addColorStop(1, p.color.dark);
  ctx.fillStyle = g;
  ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
  ctx.strokeStyle = '#2c3e50'; ctx.lineWidth=2;
  ctx.strokeRect(-p.w/2, -p.h/2, p.w, p.h);
  ctx.restore();
}

function drawStarSparkle(s) {
  const y = s.y + cameraY;
  const a = s.life / 60;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(s.x, y);
  ctx.rotate((60-s.life)*0.1);
  drawStarShape(0,0,12,'#FFD93D','#FFA502');
  ctx.restore();
}

function drawStarShape(x,y,r,fill,stroke) {
  ctx.beginPath();
  for (let i=0;i<5;i++) {
    const a = (Math.PI*2*i/5) - Math.PI/2;
    ctx.lineTo(x+Math.cos(a)*r, y+Math.sin(a)*r);
    const a2 = a + Math.PI/5;
    ctx.lineTo(x+Math.cos(a2)*r*0.5, y+Math.sin(a2)*r*0.5);
  }
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke();
}

function drawParticles() {
  particles.forEach(p => {
    const y = p.y + cameraY;
    ctx.globalAlpha = clamp(p.life,0,1);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, y, p.size, 0, Math.PI*2); ctx.fill();
  });
  ctx.globalAlpha = 1;
}

function drawCoinFloats() {
  coinsFloat.forEach(c => {
    const y = c.y + cameraY;
    ctx.globalAlpha = c.life/60;
    ctx.fillStyle = '#FFD93D';
    ctx.strokeStyle = '#2c3e50'; ctx.lineWidth=3;
    ctx.font = 'bold 18px Comic Sans MS, sans-serif';
    ctx.textAlign='center';
    ctx.strokeText(c.text, c.x, y);
    ctx.fillText(c.text, c.x, y);
  });
  ctx.globalAlpha = 1;
}

// ----- GAME OVER -----
function gameOver() {
  state = ST.OVER;
  const totalFloors = floors.length - 1; // exclude base
  if (totalFloors > best) { best = totalFloors; localStorage.setItem('tb_best', best); }
  localStorage.setItem('tb_coins', coins);
  $('finalFloors').textContent = totalFloors;
  $('finalStars').textContent = starsCollected;
  $('finalCoins').textContent = coins;
  $('finalBest').textContent = best;
  $('pauseBtn').classList.add('hidden');
  $('ghosts').classList.add('hidden');
  setTimeout(()=> $('gameOverScreen').classList.remove('hidden'), 700);
}

function updateHUD() {
  $('floors').textContent = floors.length - 1;
  $('stars').textContent = starsCollected;
  $('coins').textContent = coins;
  $('ghostFloor').textContent = floors.length - 1;
}

// ----- MAIN LOOP -----
function loop() {
  update();
  drawSky();

  // Draw all floors
  floors.forEach(f => drawFloor(f, false));
  // Falling pieces
  fallingPieces.forEach(drawFallingPiece);
  // Crane + moving floor
  if (movingFloor) { drawCrane(); drawFloor(movingFloor, true); }
  // Stars
  stars.forEach(drawStarSparkle);
  // Particles
  drawParticles();
  // Coin floats
  drawCoinFloats();

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ----- INPUT -----
function tap(e){ if(e) e.preventDefault(); if(state===ST.PLAY) dropFloor(); }
canvas.addEventListener('pointerdown', tap);
window.addEventListener('keydown', e => { if(e.code==='Space'||e.code==='Enter'){ e.preventDefault(); tap(); }});

$('startBtn').addEventListener('click', ()=>{ sfxClick(); startGame(); });
$('restartBtn').addEventListener('click', ()=>{ sfxClick(); startGame(); });
$('muteBtn').addEventListener('click', e => {
  muted = !muted;
  e.target.textContent = muted ? '🔇 Sound: OFF' : '🔊 Sound: ON';
});
$('pauseBtn').addEventListener('click', ()=>{
  if(state===ST.PLAY){
    state=ST.PAUSE;
    $('pauseBtn').classList.add('hidden');
    $('pauseScreen').classList.remove('hidden');
    sfxClick();
  }
});
$('resumeBtn').addEventListener('click', ()=>{
  sfxClick();
  state=ST.PLAY;
  $('pauseScreen').classList.add('hidden');
  $('pauseBtn').classList.remove('hidden');
});
$('quitBtn').addEventListener('click', ()=>{
  sfxClick();
  state=ST.MENU;
  $('pauseScreen').classList.add('hidden');
  $('pauseBtn').classList.add('hidden');
  $('ghosts').classList.add('hidden');
  $('startScreen').classList.remove('hidden');
  floors=[]; movingFloor=null; particles=[]; fallingPieces=[]; stars=[]; coinsFloat=[];
  cameraY=0; targetCameraY=0; starsCollected=0; updateHUD();
});

})();
