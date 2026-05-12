/* =================================================================
   TOWER BOX — Real Physics Stacking Game
   Matter.js physics + HTML5 Canvas rendering
   Perfect square crates • 75% overlap rule • Tight stacking
   ================================================================= */
(() => {
'use strict';

const { Engine, World, Bodies, Body, Events, Composite } = Matter;

// ---------- CANVAS SETUP ----------
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
window.addEventListener('resize', resize);
resize();

// ---------- AUDIO ----------
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
const sfxDrop = ()=> tone(300,0.08,'square',0.15);
const sfxLand = ()=> { tone(160,0.08,'square',0.22); setTimeout(()=>tone(120,0.1,'square',0.18),60); };
const sfxPerfect = ()=> { tone(660,0.08,'triangle',0.2); setTimeout(()=>tone(880,0.1,'triangle',0.2),60); setTimeout(()=>tone(1320,0.14,'triangle',0.22),130); };
const sfxStar = ()=> tone(1568,0.18,'triangle',0.22);
const sfxFall = ()=> tone(120,0.5,'sawtooth',0.25);
const sfxClick= ()=> tone(800,0.04,'square',0.1);

// ---------- STATE ----------
const ST = { MENU:'menu', PLAY:'play', OVER:'over', PAUSE:'pause' };
let state = ST.MENU;

// Physics engine
let engine, world;

// Game objects
let crates = [];          // {body, color, perfect, stable}
let movingCrate = null;   // {x, color} - hangs on crane (NOT physics)
let particles = [];
let starsFx = [];
let coinsFloat = [];
let cloudsArr = [];
let blimps = [];

// Game vars
const BOX_SIZE = 56;       // ALL crates are square - same size!
const STACK_OVERLAP_RATIO = 0.75; // must overlap 75%+
let craneX = 0;
let craneDir = 1;
let craneSpeed = 2.2;
let ground = null;         // physics body for full-width ground
let cameraY = 0, targetCameraY = 0;

let coins = parseInt(localStorage.getItem('tb_coins')||'0');
let starsCount = 0;
let best = parseInt(localStorage.getItem('tb_best')||'0');
let comboStreak = 0;
let perfectCount = 0;
let wind = 0;              // wind effect at high scores

// ---------- HELPERS ----------
const $ = id => document.getElementById(id);
const rand = (a,b)=> a+Math.random()*(b-a);
const clamp = (v,a,b)=> Math.max(a,Math.min(b,v));
const lerp = (a,b,t)=> a+(b-a)*t;

// ---------- PALETTE (crate colors) ----------
const palette = [
  { body:'#E67E22', dark:'#A04000', accent:'#F5B041' }, // orange crate
  { body:'#3498DB', dark:'#1B4F72', accent:'#85C1E2' }, // blue
  { body:'#F1C40F', dark:'#9A7D0A', accent:'#F9E79F' }, // yellow
  { body:'#27AE60', dark:'#196F3D', accent:'#7DCEA0' }, // green
  { body:'#E74C3C', dark:'#922B21', accent:'#F1948A' }, // red
  { body:'#9B59B6', dark:'#5B2C6F', accent:'#BB8FCE' }, // purple
  { body:'#E91E63', dark:'#880E4F', accent:'#F48FB1' }, // pink
];
const crateColor = i => palette[i % palette.length];

// ---------- INIT PHYSICS WORLD ----------
function initPhysics() {
  engine = Engine.create();
  world = engine.world;
  engine.gravity.y = 1.2;

  // Full-width ground (covers entire screen left to right)
  const groundY = H - 60;
  ground = Bodies.rectangle(W/2, groundY + 60, W*3, 120, {
    isStatic:true,
    friction: 0.95,
    restitution: 0,
    label:'ground',
  });
  World.add(world, ground);

  // Collision events to detect landed crates
  Events.on(engine, 'collisionStart', (e) => {
    e.pairs.forEach(pair => {
      const { bodyA, bodyB } = pair;
      crates.forEach(c => {
        if (!c.landed && (bodyA === c.body || bodyB === c.body)) {
          const other = bodyA === c.body ? bodyB : bodyA;
          if (other.label === 'ground' || other.label === 'crate') {
            handleCrateLanded(c, other);
          }
        }
      });
    });
  });
}

// ---------- HANDLE LANDED CRATE ----------
function handleCrateLanded(c, other) {
  if (c.landed) return;
  c.landed = true;

  // Determine if stable based on overlap with surface below
  const cBody = c.body;
  const cLeft  = cBody.position.x - BOX_SIZE/2;
  const cRight = cBody.position.x + BOX_SIZE/2;

  let surfaceLeft, surfaceRight, surfaceY;
  if (other.label === 'ground') {
    surfaceLeft = 0;
    surfaceRight = W;
    surfaceY = H - 120;
  } else {
    surfaceLeft  = other.position.x - BOX_SIZE/2;
    surfaceRight = other.position.x + BOX_SIZE/2;
    surfaceY     = other.position.y - BOX_SIZE/2;
  }

  const overlap = Math.max(0, Math.min(cRight, surfaceRight) - Math.max(cLeft, surfaceLeft));
  const overlapRatio = overlap / BOX_SIZE;

  // Position offset (center alignment)
  const offset = Math.abs(cBody.position.x - (other.position.x || W/2));

  if (overlapRatio >= STACK_OVERLAP_RATIO) {
    // STABLE — make it static so the tower doesn't wobble
    // But only after a brief settle delay to look natural
    if (offset < 4 && other.label === 'crate') {
      // PERFECT!
      c.perfect = true;
      comboStreak++;
      perfectCount++;
      starsCount++;
      coins += 10;
      showCombo(`PERFECT x${comboStreak}!`);
      sfxPerfect();
      burstSparkle(cBody.position.x, cBody.position.y);
      starsFx.push({ x: cBody.position.x, y: cBody.position.y - 30, life:60 });
      coinsFloat.push({ x: cBody.position.x, y: cBody.position.y-10, text:'+10 🪙', life:60 });
      // Snap to perfect alignment
      Body.setPosition(cBody, { x: other.position.x, y: cBody.position.y });
      Body.setVelocity(cBody, { x:0, y:0 });
      Body.setAngularVelocity(cBody, 0);
      Body.setAngle(cBody, 0);
    } else {
      comboStreak = 0;
      coins += 1;
      sfxLand();
      coinsFloat.push({ x: cBody.position.x, y: cBody.position.y-10, text:'+1', life:50 });
    }
    c.stable = true;
    // Lock crate into place after short settle
    setTimeout(()=>{
      if (c.body && state === ST.PLAY) {
        Body.setStatic(c.body, true);
      }
    }, 150);

    // Update camera target to follow tower up
    const stableCrates = crates.filter(x => x.stable);
    if (stableCrates.length > 0) {
      const topY = Math.min(...stableCrates.map(x => x.body.position.y));
      // Keep top crate around 35% from top of screen
      targetCameraY = Math.max(0, (H * 0.35) - topY);
    }

    updateHUD();

    // Spawn next crate
    setTimeout(()=> { if (state === ST.PLAY) spawnNewCrate(); }, 250);
  } else {
    // NOT enough overlap → it will tip and fall (physics handles tilt)
    comboStreak = 0;
    sfxFall();
    // Give it a push to tip realistically
    const dir = cBody.position.x < (other.position.x || W/2) ? -1 : 1;
    Body.applyForce(cBody, cBody.position, { x: 0.02 * dir, y: 0 });
    Body.setAngularVelocity(cBody, 0.05 * dir);
    // Game over after it falls
    setTimeout(() => {
      if (state === ST.PLAY) gameOver();
    }, 1200);
  }
}

// ---------- CRATE SPAWN ----------
function spawnNewCrate() {
  // Choose start side based on crane position
  craneX = Math.random() < 0.5 ? BOX_SIZE : W - BOX_SIZE;
  craneDir = craneX < W/2 ? 1 : -1;
  craneSpeed = 2.2 + Math.min(crates.length * 0.05, 2.8);
  movingCrate = {
    x: craneX,
    y: 90,
    color: crateColor(crates.length),
  };
  // Increase wind difficulty at higher altitudes
  wind = crates.length > 15 ? Math.sin(Date.now()*0.001) * 0.3 : 0;
}

// ---------- DROP CRATE ----------
function dropCrate() {
  if (state !== ST.PLAY || !movingCrate) return;
  // Create physics body where the moving crate is
  const body = Bodies.rectangle(movingCrate.x, movingCrate.y, BOX_SIZE, BOX_SIZE, {
    friction: 0.9,
    frictionStatic: 1.2,
    restitution: 0.02,
    density: 0.01,
    label: 'crate',
  });
  World.add(world, body);
  crates.push({
    body,
    color: movingCrate.color,
    landed:false, stable:false, perfect:false,
  });
  sfxDrop();
  movingCrate = null;
}

// ---------- INIT SKY ----------
function initSky() {
  cloudsArr = [];
  for (let i=0;i<8;i++) cloudsArr.push({
    x: rand(-50,W+50),
    y: rand(40, H-220),
    s: rand(0.6,1.3),
    vx: rand(0.15,0.45),
  });
  blimps = [];
  for (let i=0;i<2;i++) blimps.push({
    x: rand(-200,W),
    y: rand(120, H/2),
    vx: rand(0.4,0.8),
    color: ['#FF6B9D','#5DADE2','#F8C471'][i%3],
  });
}

// ---------- START GAME ----------
function startGame() {
  initAudio();

  // Cleanup previous world
  if (world) World.clear(world, false);
  if (engine) Engine.clear(engine);

  crates = [];
  particles = [];
  starsFx = [];
  coinsFloat = [];
  cameraY = 0; targetCameraY = 0;
  comboStreak = 0; perfectCount = 0; starsCount = 0;
  state = ST.PLAY;

  initPhysics();
  initSky();

  // Place first crate sitting on ground center, automatically
  const firstCrate = Bodies.rectangle(W/2, H - 120 - BOX_SIZE/2, BOX_SIZE, BOX_SIZE, {
    isStatic:true, label:'crate',
  });
  World.add(world, firstCrate);
  crates.push({
    body: firstCrate,
    color: crateColor(0),
    landed:true, stable:true, perfect:false,
  });

  spawnNewCrate();
  updateHUD();

  $('startScreen').classList.add('hidden');
  $('gameOverScreen').classList.add('hidden');
  $('pauseScreen').classList.add('hidden');
  $('pauseBtn').classList.remove('hidden');
}

// ---------- COMBO TEXT ----------
function showCombo(text) {
  const el = $('comboText');
  el.textContent = text;
  el.classList.remove('hidden');
  // restart animation
  el.style.animation = 'none'; el.offsetHeight;
  el.style.animation = 'comboPop 0.8s ease-out forwards';
  setTimeout(()=> el.classList.add('hidden'), 800);
}

// ---------- PARTICLES ----------
function burstSparkle(x,y) {
  for (let i=0;i<24;i++) {
    particles.push({
      x, y,
      vx: rand(-4,4), vy: rand(-6,-1),
      life:1, size: rand(2,5),
      color: ['#FFE066','#FFD93D','#FFFFFF','#FFA502'][i%4],
    });
  }
}

// ---------- UPDATE ----------
function update() {
  if (state !== ST.PLAY) return;

  // Step physics
  Engine.update(engine, 1000/60);

  // Move crane back & forth
  if (movingCrate) {
    movingCrate.x += craneDir * craneSpeed;
    if (movingCrate.x > W - BOX_SIZE/2 - 5) { movingCrate.x = W - BOX_SIZE/2 - 5; craneDir = -1; }
    if (movingCrate.x < BOX_SIZE/2 + 5)     { movingCrate.x = BOX_SIZE/2 + 5;     craneDir =  1; }
  }

  // Apply wind to non-static crates at high altitudes
  if (wind !== 0) {
    crates.forEach(c => {
      if (!c.body.isStatic) {
        Body.applyForce(c.body, c.body.position, { x: wind * 0.0001, y: 0 });
      }
    });
  }

  // Check for fallen crates (off-screen)
  crates.forEach(c => {
    if (!c.body.isStatic && c.body.position.y > H + 200) {
      // Crate fell off
      if (c.stable) {
        // A stable crate falling means tower collapsed
        if (state === ST.PLAY) gameOver();
      }
    }
  });

  // Camera lerp
  cameraY = lerp(cameraY, targetCameraY, 0.08);

  // Clouds & blimps
  cloudsArr.forEach(c => { c.x += c.vx; if (c.x > W+80) { c.x = -80; c.y = rand(40, H-220); }});
  blimps.forEach(b => { b.x += b.vx; if (b.x > W+150) { b.x = -150; b.y = rand(120, H/2); }});

  // FX
  particles = particles.filter(p => p.life > 0);
  particles.forEach(p => { p.x+=p.vx; p.y+=p.vy; p.vy+=0.25; p.life-=0.02; });
  starsFx = starsFx.filter(s => s.life > 0);
  starsFx.forEach(s => { s.y -= 1; s.life--; });
  coinsFloat = coinsFloat.filter(c => c.life > 0);
  coinsFloat.forEach(c => { c.y -= 1.2; c.life--; });
}

// ---------- DRAW SKY ----------
function drawSky() {
  const g = ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,'#7ec8e3');
  g.addColorStop(0.6,'#a8d8ea');
  g.addColorStop(1,'#d4ebf2');
  ctx.fillStyle = g;
  ctx.fillRect(0,0,W,H);

  // Sun
  ctx.fillStyle = 'rgba(255,235,150,0.7)';
  ctx.beginPath(); ctx.arc(W-55, 75, 38, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#FFD93D';
  ctx.beginPath(); ctx.arc(W-55, 75, 24, 0, Math.PI*2); ctx.fill();

  // Clouds
  cloudsArr.forEach(c => drawCloud(c.x, c.y, c.s));
  // Blimps
  blimps.forEach(b => drawBlimp(b.x, b.y, b.color));

  // City skyline parallax (far)
  drawSkyline();
}

function drawCloud(x,y,s) {
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x, y, 20*s, 0, Math.PI*2);
  ctx.arc(x+22*s, y-7*s, 24*s, 0, Math.PI*2);
  ctx.arc(x+42*s, y, 19*s, 0, Math.PI*2);
  ctx.arc(x+22*s, y+9*s, 20*s, 0, Math.PI*2);
  ctx.fill();
  ctx.strokeStyle='rgba(80,100,140,0.2)'; ctx.lineWidth=2; ctx.stroke();
}

function drawBlimp(x,y,color) {
  ctx.save();
  ctx.translate(x,y);
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.ellipse(0,0,42,15,0,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle='#2c3e50'; ctx.lineWidth=2; ctx.stroke();
  ctx.fillStyle='#fff'; ctx.fillRect(-22,-2,44,4);
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(40,0); ctx.lineTo(50,-8); ctx.lineTo(50,8); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.fillStyle='#ecf0f1';
  ctx.fillRect(-9,13,18,6);
  ctx.strokeRect(-9,13,18,6);
  ctx.restore();
}

function drawSkyline() {
  // Far city silhouette - parallax with camera
  const skyY = H - 130 + cameraY*0.15;
  if (skyY > H || skyY < -100) return;
  ctx.fillStyle = 'rgba(100,130,170,0.5)';
  const buildings = [
    {x:0,w:50,h:60},{x:55,w:35,h:80},{x:95,w:55,h:50},
    {x:155,w:40,h:90},{x:200,w:60,h:65},{x:265,w:45,h:75},
    {x:315,w:50,h:85},{x:370,w:40,h:55},{x:415,w:55,h:70},
    {x:475,w:45,h:80},
  ];
  buildings.forEach(b => {
    if (b.x < W) ctx.fillRect(b.x, skyY - b.h, b.w, b.h+10);
  });
}

// ---------- DRAW GROUND ----------
function drawGround() {
  const gy = H - 120 + cameraY;
  if (gy > H + 100 || gy < -300) return;
  // Concrete base
  const g = ctx.createLinearGradient(0, gy, 0, gy+200);
  g.addColorStop(0,'#7f8c8d');
  g.addColorStop(1,'#34495e');
  ctx.fillStyle = g;
  ctx.fillRect(0, gy, W, 200);
  // Green grass strip
  ctx.fillStyle = '#27ae60';
  ctx.fillRect(0, gy-2, W, 6);
  ctx.fillStyle = '#1e8449';
  ctx.fillRect(0, gy+4, W, 2);
  // Construction marks
  ctx.strokeStyle = '#FFD93D'; ctx.lineWidth=3;
  ctx.setLineDash([10,10]);
  ctx.beginPath();
  ctx.moveTo(0, gy + 25); ctx.lineTo(W, gy + 25);
  ctx.stroke();
  ctx.setLineDash([]);
  // Rivets
  for (let i=10;i<W;i+=30) {
    ctx.fillStyle = '#2c3e50';
    ctx.beginPath(); ctx.arc(i, gy+50, 3, 0, Math.PI*2); ctx.fill();
  }
}

// ---------- DRAW CRATE ----------
function drawCrate(c, x, y, angle=0, isMoving=false) {
  const col = c.color;
  ctx.save();
  ctx.translate(x, y + cameraY);
  ctx.rotate(angle);

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(-BOX_SIZE/2 + 3, -BOX_SIZE/2 + 3, BOX_SIZE, BOX_SIZE);

  // Body gradient
  const g = ctx.createLinearGradient(0,-BOX_SIZE/2, 0, BOX_SIZE/2);
  g.addColorStop(0, col.accent);
  g.addColorStop(0.5, col.body);
  g.addColorStop(1, col.dark);
  ctx.fillStyle = g;
  ctx.fillRect(-BOX_SIZE/2, -BOX_SIZE/2, BOX_SIZE, BOX_SIZE);

  // Crate planks (horizontal)
  ctx.strokeStyle = col.dark; ctx.lineWidth=2;
  ctx.beginPath();
  ctx.moveTo(-BOX_SIZE/2, -BOX_SIZE/6); ctx.lineTo(BOX_SIZE/2, -BOX_SIZE/6);
  ctx.moveTo(-BOX_SIZE/2,  BOX_SIZE/6); ctx.lineTo(BOX_SIZE/2,  BOX_SIZE/6);
  ctx.stroke();

  // Diagonal X bracing
  ctx.strokeStyle = col.dark; ctx.lineWidth=2.5;
  ctx.beginPath();
  ctx.moveTo(-BOX_SIZE/2, -BOX_SIZE/2); ctx.lineTo(BOX_SIZE/2, BOX_SIZE/2);
  ctx.moveTo(BOX_SIZE/2, -BOX_SIZE/2); ctx.lineTo(-BOX_SIZE/2, BOX_SIZE/2);
  ctx.stroke();

  // Top highlight
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(-BOX_SIZE/2, -BOX_SIZE/2, BOX_SIZE, 4);

  // Corner bolts
  ctx.fillStyle = '#2c3e50';
  const bolt = 3;
  [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([dx,dy])=>{
    ctx.beginPath();
    ctx.arc(dx*(BOX_SIZE/2 - 5), dy*(BOX_SIZE/2 - 5), bolt, 0, Math.PI*2);
    ctx.fill();
  });

  // Outline
  ctx.strokeStyle = '#2c3e50'; ctx.lineWidth=2;
  ctx.strokeRect(-BOX_SIZE/2, -BOX_SIZE/2, BOX_SIZE, BOX_SIZE);

  if (isMoving) {
    ctx.shadowColor='#FFD93D'; ctx.shadowBlur=18;
    ctx.strokeStyle='rgba(255,217,61,0.9)'; ctx.lineWidth=3;
    ctx.strokeRect(-BOX_SIZE/2+1, -BOX_SIZE/2+1, BOX_SIZE-2, BOX_SIZE-2);
  }

  ctx.restore();
}

// ---------- DRAW CRANE ----------
function drawCrane() {
  if (!movingCrate) return;
  const cx = movingCrate.x;
  const cy = movingCrate.y;

  // Top horizontal beam (entire screen width)
  ctx.fillStyle = '#2c3e50';
  ctx.fillRect(0, 25, W, 10);
  // Diagonal supports
  ctx.strokeStyle = '#2c3e50'; ctx.lineWidth=4;
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(60, 30);
  ctx.moveTo(W, 0); ctx.lineTo(W-60, 30);
  ctx.stroke();

  // Trolley on the beam
  ctx.fillStyle = '#FFD93D';
  ctx.fillRect(cx-18, 20, 36, 18);
  ctx.strokeStyle='#2c3e50'; ctx.lineWidth=2;
  ctx.strokeRect(cx-18, 20, 36, 18);
  // Wheels
  ctx.fillStyle='#2c3e50';
  ctx.beginPath(); ctx.arc(cx-12, 20, 4, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx+12, 20, 4, 0, Math.PI*2); ctx.fill();

  // Rope (cable)
  ctx.strokeStyle='#2c3e50'; ctx.lineWidth=2;
  ctx.beginPath();
  ctx.moveTo(cx, 38);
  ctx.lineTo(cx, cy - BOX_SIZE/2 - 8);
  ctx.stroke();

  // Hook block
  ctx.fillStyle = '#2c3e50';
  ctx.fillRect(cx-10, cy - BOX_SIZE/2 - 12, 20, 6);
  ctx.fillStyle = '#34495e';
  ctx.fillRect(cx-8, cy - BOX_SIZE/2 - 6, 16, 4);
}

// ---------- DRAW PARTICLES ----------
function drawParticles() {
  particles.forEach(p => {
    ctx.globalAlpha = clamp(p.life,0,1);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y + cameraY, p.size, 0, Math.PI*2); ctx.fill();
  });
  ctx.globalAlpha = 1;
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
  ctx.fillStyle=fill; ctx.fill();
  ctx.strokeStyle=stroke; ctx.lineWidth=2; ctx.stroke();
}

function drawStars() {
  starsFx.forEach(s => {
    ctx.save();
    ctx.globalAlpha = s.life/60;
    ctx.translate(s.x, s.y + cameraY);
    ctx.rotate((60-s.life)*0.1);
    drawStarShape(0,0,14,'#FFD93D','#FFA502');
    ctx.restore();
  });
}

function drawCoinFloats() {
  coinsFloat.forEach(c => {
    ctx.globalAlpha = c.life/60;
    ctx.fillStyle = '#FFD93D';
    ctx.strokeStyle = '#2c3e50'; ctx.lineWidth=3;
    ctx.font = 'bold 18px Comic Sans MS, sans-serif';
    ctx.textAlign='center';
    ctx.strokeText(c.text, c.x, c.y + cameraY);
    ctx.fillText(c.text, c.x, c.y + cameraY);
  });
  ctx.globalAlpha=1;
}

// ---------- MAIN LOOP ----------
function loop() {
  update();
  drawSky();
  drawGround();

  // Draw all physics crates with their actual rotation
  crates.forEach(c => {
    if (c.body) {
      drawCrate(c, c.body.position.x, c.body.position.y, c.body.angle, false);
    }
  });

  // Crane + hanging crate
  if (movingCrate) {
    drawCrane();
    drawCrate(movingCrate, movingCrate.x, movingCrate.y, 0, true);
  }

  drawStars();
  drawParticles();
  drawCoinFloats();

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------- GAME OVER ----------
function gameOver() {
  if (state === ST.OVER) return;
  state = ST.OVER;
  sfxFall();
  const stacked = crates.filter(c => c.stable).length - 1;
  if (stacked > best) { best = stacked; localStorage.setItem('tb_best', best); }
  localStorage.setItem('tb_coins', coins);
  $('finalFloors').textContent = stacked;
  $('finalStars').textContent = starsCount;
  $('finalCoins').textContent = coins;
  $('finalBest').textContent = best;
  $('pauseBtn').classList.add('hidden');
  setTimeout(()=> $('gameOverScreen').classList.remove('hidden'), 900);
}

function updateHUD() {
  $('floors').textContent = crates.filter(c => c.stable).length - 1;
  $('stars').textContent = starsCount;
  $('coins').textContent = coins;
}

// ---------- INPUT ----------
function tap(e){ if(e) e.preventDefault(); if(state===ST.PLAY) dropCrate(); }
canvas.addEventListener('pointerdown', tap);
window.addEventListener('keydown', e => { if(e.code==='Space'||e.code==='Enter'){ e.preventDefault(); tap(); }});

$('startBtn').addEventListener('click', ()=>{ sfxClick(); startGame(); });
$('restartBtn').addEventListener('click', ()=>{ sfxClick(); startGame(); });
$('muteBtn').addEventListener('click', e => {
  muted=!muted;
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
  $('startScreen').classList.remove('hidden');
  if (world) World.clear(world, false);
  crates=[]; movingCrate=null; particles=[]; starsFx=[]; coinsFloat=[];
  cameraY=0; targetCameraY=0; starsCount=0; comboStreak=0;
  updateHUD();
});

})();
