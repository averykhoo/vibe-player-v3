// ─────────────────────────────────────────────────────────────────────────────
//  sparkles.js
//  A self-contained sparkle/dot effect that you can turn on/off by calling
//    sparkle(true)  or  sparkle(false)  or  sparkle() to toggle.
//  No external CSS or other files needed.
// ─────────────────────────────────────────────────────────────────────────────

(function () {
    // ───────────────────────────────────────────────────────────────────────────
    //  CONFIGURATION CONSTANTS
    // ───────────────────────────────────────────────────────────────────────────
    const MAX_SPARKLES = 1000;
    const SPARKLE_LIFETIME = 30;   // Each “star” lives 2× this, then becomes a dot for 2× this
    const SPARKLE_DISTANCE = 30;   // Affects how many spawn along fast mouse movements

    // ───────────────────────────────────────────────────────────────────────────
    //  INTERNAL STATE
    // ───────────────────────────────────────────────────────────────────────────
    let canvas, ctx, docW, docH;
    let isInitialized = false;
    let sparklesEnabled = false;
    let animationRunning = false;
    let lastSpawnTime = 0;

    // Pools: one array for “stars,” one for “tinnies” (dots).
    // At index i, either a star or dot (or both) can be active simultaneously.
    const stars = [];
    const tinnies = [];
    for (let i = 0; i < MAX_SPARKLES; i++) {
        stars.push({active: false, x: 0, y: 0, ticksLeft: 0, color: ""});
        tinnies.push({active: false, x: 0, y: 0, ticksLeft: 0, color: ""});
    }

    // Precompute a small pool of random “star” colors so we don't build new strings per spawn
    const COLOR_POOL = [];
    (function buildColorPool() {
        for (let i = 0; i < 512; i++) {
            const c1 = 255;
            const c2 = Math.floor(Math.random() * 256);
            const c3 = Math.floor(Math.random() * (256 - c2 / 2));
            const arr = [c1, c2, c3];
            arr.sort(() => 0.5 - Math.random());
            COLOR_POOL.push(`rgb(${arr[0]}, ${arr[1]}, ${arr[2]})`);
        }
    })();

    // ───────────────────────────────────────────────────────────────────────────
    //  INITIALIZATION (runs once when DOMContentLoaded fires)
    // ───────────────────────────────────────────────────────────────────────────
    function initialize() {
        // Only run once
        if (isInitialized) return;
        isInitialized = true;

        // 1) Create and append a full-screen <canvas>
        docW = document.documentElement.scrollWidth;
        docH = document.documentElement.scrollHeight;

        canvas = document.createElement("canvas");
        canvas.style.position = "fixed";
        canvas.style.top = "0";
        canvas.style.left = "0";
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.pointerEvents = "none";
        canvas.style.zIndex = "999";
        canvas.width = docW;
        canvas.height = docH;
        document.body.appendChild(canvas);
        ctx = canvas.getContext("2d");

        // 2) Hook up resize listener
        window.addEventListener("resize", handleResize);

        // 3) Hook up mousemove listener
        document.addEventListener("mousemove", onMouseMove);

        // 4) If someone already called sparkle(true) before init, start animating now
        if (sparklesEnabled && !animationRunning) {
            animationRunning = true;
            requestAnimationFrame(animate);
        }
    }

    // When window resizes, update canvas dimensions
    function handleResize() {
        if (!canvas) return;
        docW = document.documentElement.scrollWidth;
        docH = document.documentElement.scrollHeight;
        canvas.width = docW;
        canvas.height = docH;
    }

    // ───────────────────────────────────────────────────────────────────────────
    //  SPAWNING LOGIC: place a “star” in the pool (or convert an old one to a dot)
    // ───────────────────────────────────────────────────────────────────────────
    function spawnStar(x, y) {
        // If out of bounds, do nothing
        if (x + 5 >= docW || y + 5 >= docH) return;

        // Find either an inactive slot or the slot with the smallest ticksLeft
        let chosenIdx = -1;
        let minTicks = SPARKLE_LIFETIME * 2 + 1;
        for (let i = 0; i < MAX_SPARKLES; i++) {
            const s = stars[i];
            if (!s.active) {
                chosenIdx = i;
                minTicks = null;
                break;
            } else if (s.ticksLeft < minTicks) {
                minTicks = s.ticksLeft;
                chosenIdx = i;
            }
        }

        // If that slot had an active star, convert it immediately into a “tiny” first
        if (minTicks !== null) {
            const oldStar = stars[chosenIdx];
            tinnies[chosenIdx].active = true;
            tinnies[chosenIdx].x = oldStar.x;
            tinnies[chosenIdx].y = oldStar.y;
            tinnies[chosenIdx].ticksLeft = SPARKLE_LIFETIME * 2;
            tinnies[chosenIdx].color = oldStar.color;
        }

        // Initialize this slot as a brand-new star
        const newStar = stars[chosenIdx];
        const col = COLOR_POOL[Math.floor(Math.random() * COLOR_POOL.length)];
        newStar.active = true;
        newStar.x = x;
        newStar.y = y;
        newStar.ticksLeft = SPARKLE_LIFETIME * 2;
        newStar.color = col;
    }

    // ───────────────────────────────────────────────────────────────────────────
    //  ANIMATION LOOP: update and draw all active stars and dots each frame
    // ───────────────────────────────────────────────────────────────────────────
    function animate() {
        // Clear entire canvas once per frame
        ctx.clearRect(0, 0, docW, docH);

        let anyAlive = false;

        // --- 1) Update & draw “stars” ---
        for (let i = 0; i < MAX_SPARKLES; i++) {
            const s = stars[i];
            if (!s.active) continue;

            s.ticksLeft--;
            if (s.ticksLeft === 0) {
                // Convert to a “tiny” dot immediately
                tinnies[i].active = true;
                tinnies[i].x = s.x;
                tinnies[i].y = s.y;
                tinnies[i].ticksLeft = SPARKLE_LIFETIME * 2;
                tinnies[i].color = s.color;
                s.active = false;
                anyAlive = true;
                continue;
            }

            // Move the star downward + sideways
            s.y += 1 + 3 * Math.random();
            s.x += (i % 5 - 2) / 5;

            if (s.y + 5 < docH && s.x + 5 < docW) {
                // Draw—either full 5×5 “+” or half‐shrunken 3×3 “+”
                const halfLife = SPARKLE_LIFETIME;
                ctx.strokeStyle = s.color;
                ctx.lineWidth = 1;
                if (s.ticksLeft > halfLife) {
                    // Full 5×5 cross
                    const cx = s.x + 2;
                    const cy = s.y + 2;
                    ctx.beginPath();
                    ctx.moveTo(s.x, cy);
                    ctx.lineTo(s.x + 5, cy);
                    ctx.moveTo(cx, s.y);
                    ctx.lineTo(cx, s.y + 5);
                    ctx.stroke();
                } else {
                    // 3×3 cross
                    const cx = s.x + 1;
                    const cy = s.y + 1;
                    ctx.beginPath();
                    ctx.moveTo(s.x, cy);
                    ctx.lineTo(s.x + 3, cy);
                    ctx.moveTo(cx, s.y);
                    ctx.lineTo(cx, s.y + 3);
                    ctx.stroke();
                }
                anyAlive = true;
            } else {
                // Out of bounds → kill it
                s.active = false;
            }
        }

        // --- 2) Update & draw “tinnies” (dots) ---
        for (let i = 0; i < MAX_SPARKLES; i++) {
            const t = tinnies[i];
            if (!t.active) continue;

            t.ticksLeft--;
            if (t.ticksLeft === 0) {
                t.active = false;
                continue;
            }

            // Move the dot
            t.y += 1 + 2 * Math.random();
            t.x += (i % 4 - 2) / 4;

            if (t.y + 3 < docH && t.x + 3 < docW) {
                const halfLife = SPARKLE_LIFETIME;
                ctx.fillStyle = t.color;
                if (t.ticksLeft > halfLife) {
                    // 2×2 square
                    ctx.fillRect(t.x, t.y, 2, 2);
                } else {
                    // 1×1 pixel (centered)
                    ctx.fillRect(t.x + 0.5, t.y + 0.5, 1, 1);
                }
                anyAlive = true;
            } else {
                t.active = false;
            }
        }

        // Continue looping if any sparkle is alive OR if sparklesEnabled is still true
        if (anyAlive || sparklesEnabled) {
            animationRunning = true;
            requestAnimationFrame(animate);
        } else {
            animationRunning = false;
            // Clear once more to fully blank the canvas
            ctx.clearRect(0, 0, docW, docH);
        }
    }

    // ───────────────────────────────────────────────────────────────────────────
    //  MOUSEMOVE HANDLER: throttle to ≈60fps, spawn stars along the path
    // ───────────────────────────────────────────────────────────────────────────
    function onMouseMove(e) {
        if (!sparklesEnabled) return;

        const now = performance.now();
        if (now - lastSpawnTime < 16) return; // ≈16ms → ~60fps
        lastSpawnTime = now;

        const dx = e.movementX;
        const dy = e.movementY;
        const dist = Math.hypot(dx, dy);
        if (dist < 0.5) return;

        const prob = dist / SPARKLE_DISTANCE;
        let cum = 0;
        let mx = e.pageX;
        let my = e.pageY;
        const stepX = (dx * SPARKLE_DISTANCE * 2) / dist;
        const stepY = (dy * SPARKLE_DISTANCE * 2) / dist;

        while (Math.abs(cum) < Math.abs(dx)) {
            if (Math.random() < prob) {
                spawnStar(mx, my);
            }
            const frac = Math.random();
            mx -= stepX * frac;
            my -= stepY * frac;
            cum += stepX * frac;
        }

        // If the animation loop isn’t running yet, kick it off now
        if (!animationRunning && isInitialized) {
            animationRunning = true;
            requestAnimationFrame(animate);
        }
    }

    // ───────────────────────────────────────────────────────────────────────────
    //  PUBLIC API: window.sparkle(enable)
    //    - sparkle(true)  → turn ON sparkles
    //    - sparkle(false) → turn OFF immediately (clears all alive particles)
    //    - sparkle()      → toggle on/off
    // ───────────────────────────────────────────────────────────────────────────
    window.sparkle = function (enable = null) {
        // If enable is omitted, toggle
        if (enable === null) {
            sparklesEnabled = !sparklesEnabled;
        } else {
            sparklesEnabled = !!enable;
        }

        // If turning off, clear all active particles
        if (!sparklesEnabled && isInitialized) {
            for (let i = 0; i < MAX_SPARKLES; i++) {
                stars[i].active = false;
                tinnies[i].active = false;
            }
        }

        // If turning on, but not yet initialized, do nothing now. Once DOMContentLoaded fires,
        // initialize() will see sparklesEnabled===true and start the loop.
        if (sparklesEnabled && isInitialized && !animationRunning) {
            animationRunning = true;
            requestAnimationFrame(animate);
        }
    };

    // ───────────────────────────────────────────────────────────────────────────
    //  WAIT FOR DOM TO BE READY, THEN INITIALIZE
    // ───────────────────────────────────────────────────────────────────────────
    if (document.readyState === "complete" || document.readyState === "interactive") {
        // If DOM is already ready (e.g. script placed near end), initialize immediately
        initialize();
    } else {
        // Otherwise, wait for DOMContentLoaded
        document.addEventListener("DOMContentLoaded", initialize);
    }

})();
