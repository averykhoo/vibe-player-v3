// vibe-player/js/sparkles.js
// ─────────────────────────────────────────────────────────────────────────────
//  sparkles.js
//  A self-contained sparkle/dot effect that you can turn on/off by calling
//    sparkle(true)  or  sparkle(false)  or  sparkle() to toggle.
//  No external CSS or other files needed.
// ─────────────────────────────────────────────────────────────────────────────

(function () {
    'use strict';
    // ───────────────────────────────────────────────────────────────────────────
    //  CONFIGURATION CONSTANTS
    // ───────────────────────────────────────────────────────────────────────────
    /** @const {number} Maximum number of concurrent sparkles. */
    const MAX_SPARKLES = 1000;
    /** @const {number} Base lifetime for sparkles (in animation ticks). Stars live 2x this, then dots live 2x this. */
    const SPARKLE_LIFETIME = 40;
    /** @const {number} Controls spawn density along mouse path; smaller means more sparkles. */
    const SPARKLE_DISTANCE = 10;

    // ───────────────────────────────────────────────────────────────────────────
    //  INTERNAL STATE
    // ───────────────────────────────────────────────────────────────────────────
    /** @type {HTMLCanvasElement|null} The canvas element for drawing sparkles. */
    let canvas = null;
    /** @type {CanvasRenderingContext2D|null} The 2D rendering context of the canvas. */
    let ctx = null;
    /** @type {number} Current width of the document viewport. */
    let docW = 0;
    /** @type {number} Current height of the document viewport. */
    let docH = 0;

    /** @type {boolean} Flag indicating if the sparkle system has been initialized. */
    let isInitialized = false;
    /** @type {boolean} Flag indicating if sparkles are currently enabled. */
    let sparklesEnabled = false;
    /** @type {boolean} Flag indicating if the animation loop is currently running. */
    let animationRunning = false;
    /** @type {number} Timestamp of the last sparkle spawn attempt. */
    let lastSpawnTime = 0;

    /**
     * @typedef {Object} SparkleParticle
     * @property {boolean} active - Whether the particle is currently active and should be drawn/updated.
     * @property {number} x - The x-coordinate of the particle.
     * @property {number} y - The y-coordinate of the particle.
     * @property {number} ticksLeft - Remaining lifetime of the particle in animation ticks.
     * @property {string} color - The color of the particle (CSS color string).
     */

    /** @type {SparkleParticle[]} Pool for star particles. */
    const stars = [];
    /** @type {SparkleParticle[]} Pool for tiny dot particles. */
    const tinnies = [];

    for (let i = 0; i < MAX_SPARKLES; i++) {
        stars.push({active: false, x: 0, y: 0, ticksLeft: 0, color: ""});
        tinnies.push({active: false, x: 0, y: 0, ticksLeft: 0, color: ""});
    }

    /** @type {string[]} Precomputed pool of random RGB color strings for sparkles. */
    const COLOR_POOL = [];
    (function buildColorPool() {
        for (let i = 0; i < 512; i++) {
            const c1 = 255;
            const c2 = Math.floor(Math.random() * 256);
            const c3 = Math.floor(Math.random() * (256 - c2 / 2));
            const arr = [c1, c2, c3];
            arr.sort(() => 0.5 - Math.random()); // Shuffle to vary which component is dominant
            COLOR_POOL.push(`rgb(${arr[0]}, ${arr[1]}, ${arr[2]})`);
        }
    })();

    // ───────────────────────────────────────────────────────────────────────────
    //  INITIALIZATION (runs once when DOMContentLoaded fires)
    // ───────────────────────────────────────────────────────────────────────────
    /**
     * Initializes the sparkle system: creates canvas, sets up listeners.
     * This function is called once when the DOM is ready.
     * @private
     */
    function initialize() {
        if (isInitialized) return;
        isInitialized = true;

        canvas = document.createElement("canvas");
        canvas.style.position = "fixed";
        canvas.style.top = "0";
        canvas.style.left = "0";
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.pointerEvents = "none"; // Canvas doesn't intercept mouse events
        canvas.style.zIndex = "999"; // Ensure it's on top (adjust if needed)
        document.body.appendChild(canvas);
        ctx = canvas.getContext("2d");

        handleResize();
        window.addEventListener("resize", handleResize);
        document.addEventListener("mousemove", onMouseMove);

        if (sparklesEnabled && !animationRunning) {
            animationRunning = true;
            requestAnimationFrame(animate);
        }
    }

    /**
     * Handles window resize events by updating canvas dimensions to match the viewport.
     * @private
     */
    function handleResize() {
        if (!canvas) return;
        docW = window.innerWidth;
        docH = window.innerHeight;
        canvas.width = docW;
        canvas.height = docH;
    }

    // ───────────────────────────────────────────────────────────────────────────
    //  SPAWNING LOGIC: place a “star” in the pool (or convert an old one to a dot)
    // ───────────────────────────────────────────────────────────────────────────
    /**
     * Spawns a new star particle at the given coordinates.
     * If all star slots are active, it may replace the oldest star, converting it to a dot.
     * @private
     * @param {number} x - The x-coordinate for the new star.
     * @param {number} y - The y-coordinate for the new star.
     */
    function spawnStar(x, y) {
        if (!ctx || x + 5 >= docW || y + 5 >= docH || x < 0 || y < 0) return;

        let chosenIdx = -1;
        let minTicks = SPARKLE_LIFETIME * 2 + 1; // Sentinel for oldest active star

        for (let i = 0; i < MAX_SPARKLES; i++) {
            const s = stars[i];
            if (!s.active) { // Found an inactive slot
                chosenIdx = i;
                minTicks = null; // Mark that we found a truly free slot
                break;
            } else if (s.ticksLeft < minTicks) { // Found an active star older than current minTicks
                minTicks = s.ticksLeft;
                chosenIdx = i;
            }
        }

        // If minTicks is not null here, it means all slots were active,
        // and chosenIdx points to the star with the least ticksLeft (oldest).
        if (minTicks !== null && chosenIdx !== -1) {
            const oldStar = stars[chosenIdx];
            // Convert the old star to a "tinny" dot
            const tinny = tinnies[chosenIdx];
            tinny.active = true;
            tinny.x = oldStar.x;
            tinny.y = oldStar.y;
            tinny.ticksLeft = SPARKLE_LIFETIME * 2;
            tinny.color = oldStar.color;
        }

        // Initialize the chosen slot (either inactive or oldest) as a new star
        if (chosenIdx !== -1) {
            const newStar = stars[chosenIdx];
            const col = COLOR_POOL[Math.floor(Math.random() * COLOR_POOL.length)];
            newStar.active = true;
            newStar.x = x;
            newStar.y = y;
            newStar.ticksLeft = SPARKLE_LIFETIME * 2;
            newStar.color = col;
        }
    }

    // ───────────────────────────────────────────────────────────────────────────
    //  ANIMATION LOOP: update and draw all active stars and dots each frame
    // ───────────────────────────────────────────────────────────────────────────
    /**
     * The main animation loop. Updates and draws all active particles.
     * Requests the next frame if particles are active or sparkles are enabled.
     * @private
     * @param {DOMHighResTimeStamp} timestamp - The current time provided by requestAnimationFrame.
     */
    function animate(timestamp) {
        if (!ctx) return;
        ctx.clearRect(0, 0, docW, docH);
        let anyAlive = false;

        // --- 1) Update & draw “stars” ---
        for (let i = 0; i < MAX_SPARKLES; i++) {
            const s = stars[i];
            if (!s.active) continue;

            s.ticksLeft--;
            if (s.ticksLeft <= 0) {
                // Convert to a “tiny” dot
                const tinny = tinnies[i];
                tinny.active = true;
                tinny.x = s.x;
                tinny.y = s.y;
                tinny.ticksLeft = SPARKLE_LIFETIME * 2;
                tinny.color = s.color;
                s.active = false;
                // anyAlive = true; // Dot is now alive
                continue; // Star is done
            }

            s.y += 1 + 3 * Math.random(); // Move downwards with some variance
            s.x += (i % 5 - 2) / 5; // Slight horizontal drift based on index

            if (s.y + 5 < docH && s.x + 5 < docW && s.x > -5 && s.y > -5) {
                const halfLife = SPARKLE_LIFETIME;
                ctx.strokeStyle = s.color;
                ctx.lineWidth = 1;
                if (s.ticksLeft > halfLife) { // First half of life: 5x5 cross
                    const cx = s.x + 2;
                    const cy = s.y + 2;
                    ctx.beginPath();
                    ctx.moveTo(s.x, cy);
                    ctx.lineTo(s.x + 5, cy);
                    ctx.moveTo(cx, s.y);
                    ctx.lineTo(cx, s.y + 5);
                    ctx.stroke();
                } else { // Second half of life: 3x3 cross
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
                s.active = false; // Out of bounds
            }
        }

        // --- 2) Update & draw “tinnies” (dots) ---
        for (let i = 0; i < MAX_SPARKLES; i++) {
            const t = tinnies[i];
            if (!t.active) continue;

            t.ticksLeft--;
            if (t.ticksLeft <= 0) {
                t.active = false;
                continue;
            }

            t.y += 1 + 2 * Math.random(); // Move downwards
            t.x += (i % 4 - 2) / 4; // Slight horizontal drift

            if (t.y + 3 < docH && t.x + 3 < docW && t.x > -3 && t.y > -3) {
                const halfLife = SPARKLE_LIFETIME;
                ctx.fillStyle = t.color;
                if (t.ticksLeft > halfLife) { // First half: 2x2 square
                    ctx.fillRect(t.x, t.y, 2, 2);
                } else { // Second half: 1x1 pixel
                    ctx.fillRect(t.x + 0.5, t.y + 0.5, 1, 1);
                }
                anyAlive = true;
            } else {
                t.active = false; // Out of bounds
            }
        }

        if (anyAlive || sparklesEnabled) { // Continue if particles exist or feature is on
            animationRunning = true;
            requestAnimationFrame(animate);
        } else {
            animationRunning = false;
            if (ctx) ctx.clearRect(0, 0, docW, docH); // Final clear
        }
    }

    // ───────────────────────────────────────────────────────────────────────────
    //  MOUSEMOVE HANDLER: throttle to ≈60fps, spawn stars along the path
    // ───────────────────────────────────────────────────────────────────────────
    /**
     * Handles mouse move events to spawn sparkles.
     * Throttled to approximately 60 FPS. Spawns particles along the mouse path.
     * @private
     * @param {MouseEvent} e - The mouse event.
     */
    function onMouseMove(e) {
        if (!sparklesEnabled) return;

        const now = performance.now();
        if (now - lastSpawnTime < 16) return; // Throttle to ~60fps
        lastSpawnTime = now;

        const dx = e.movementX;
        const dy = e.movementY;
        const dist = Math.hypot(dx, dy);
        if (dist < 0.5) return; // Minimal movement

        let mx = e.clientX; // Viewport-relative X
        let my = e.clientY; // Viewport-relative Y

        const prob = dist / SPARKLE_DISTANCE; // Probability of spawning a star
        let cum = 0;
        // Calculate step to move back along the mouse path for distributed spawning
        const stepX = (dx * SPARKLE_DISTANCE * 2) / dist;
        const stepY = (dy * SPARKLE_DISTANCE * 2) / dist;

        // Iterate back along the path, spawning stars probabilistically
        // Note: original logic used Math.abs(cum) < Math.abs(dx), which might be problematic if dx is small or zero.
        // A more robust approach might be to iterate based on distance or number of steps.
        // For now, keeping it similar to original while noting potential improvement.
        let pathTraversed = 0;
        const totalPathLength = dist; // Use the actual distance for path traversal limit

        while (pathTraversed < totalPathLength) {
            if (Math.random() < prob) {
                spawnStar(mx, my);
            }
            const frac = Math.random(); // Random fraction of a step
            const dmx = stepX * frac;
            const dmy = stepY * frac;
            mx -= dmx;
            my -= dmy;
            pathTraversed += Math.hypot(dmx, dmy); // Accumulate distance traversed
        }


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
    const globalRef = typeof window !== 'undefined' ? window : global;
    /**
     * @global
     * @function sparkle
     * @description Controls the sparkle effect.
     * Call with `true` to enable, `false` to disable, or no argument to toggle.
     * @param {boolean} [enable=null] - True to enable, false to disable. Toggles if null.
     */
    globalRef.sparkle = function (enable = null) {
        if (enable === null) {
            sparklesEnabled = !sparklesEnabled;
        } else {
            sparklesEnabled = !!enable; // Coerce to boolean
        }

        if (!sparklesEnabled && isInitialized) { // If turning off
            for (let i = 0; i < MAX_SPARKLES; i++) {
                stars[i].active = false;
                tinnies[i].active = false;
            }
            // Animation loop will stop itself if no particles are alive and sparklesEnabled is false
        }

        if (sparklesEnabled && isInitialized && !animationRunning) {
            animationRunning = true;
            requestAnimationFrame(animate);
        }
    };

    // ───────────────────────────────────────────────────────────────────────────
    //  WAIT FOR DOM TO BE READY, THEN INITIALIZE
    // ───────────────────────────────────────────────────────────────────────────
    if (document.readyState === "complete" || document.readyState === "interactive") {
        initialize();
    } else {
        document.addEventListener("DOMContentLoaded", initialize);
    }

})();