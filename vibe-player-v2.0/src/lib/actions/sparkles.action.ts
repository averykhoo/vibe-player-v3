// vibe-player-v2.0/src/lib/actions/sparkles.action.ts
interface Sparkle {
  id: number;
  x: number;
  y: number;
  size: number;
  opacity: number;
  vx: number;
  vy: number;
  life: number; // Lifespan in frames
  element: HTMLElement;
}

let sparkleIdCounter = 0;

export function sparkles(
  node: HTMLElement,
  options?: { color?: string; count?: number; speed?: number },
) {
  const { color = "gold", count = 3, speed = 1 } = options || {};
  let animationFrameId: number;
  let sparkles: Sparkle[] = [];

  function createSparkle(x: number, y: number): Sparkle {
    const size = Math.random() * 5 + 2; // 2px to 7px
    const sparkleEl = document.createElement("div");
    sparkleEl.style.position = "absolute";
    sparkleEl.style.left = `${x}px`;
    sparkleEl.style.top = `${y}px`;
    sparkleEl.style.width = `${size}px`;
    sparkleEl.style.height = `${size}px`;
    sparkleEl.style.backgroundColor = color;
    sparkleEl.style.borderRadius = "50%";
    sparkleEl.style.pointerEvents = "none"; // Don't interfere with mouse events
    sparkleEl.style.opacity = "1";
    node.appendChild(sparkleEl);

    return {
      id: sparkleIdCounter++,
      x,
      y,
      size,
      opacity: 1,
      vx: (Math.random() - 0.5) * 2 * speed, // Random horizontal velocity
      vy: (Math.random() - 0.5) * 1 * speed - 1, // Upward drift
      life: Math.random() * 60 + 30, // 30 to 90 frames
      element: sparkleEl,
    };
  }

  function updateSparkles() {
    sparkles = sparkles.filter((s) => {
      s.x += s.vx;
      s.y += s.vy;
      s.opacity -= 0.02; // Fade out
      s.life--;

      if (s.opacity <= 0 || s.life <= 0) {
        s.element.remove();
        return false; // Remove sparkle
      }

      s.element.style.transform = `translate(${s.x - s.size / 2}px, ${s.y - s.size / 2}px)`;
      s.element.style.opacity = String(s.opacity);
      return true;
    });
    animationFrameId = requestAnimationFrame(updateSparkles);
  }

  function handleMouseMove(event: MouseEvent) {
    if (node.contains(event.target as Node) || event.target === node) {
      const rect = node.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      for (let i = 0; i < count; i++) {
        sparkles.push(createSparkle(x, y));
      }
    }
  }

  // Ensure node is relative for absolute positioning of sparkles
  if (getComputedStyle(node).position === "static") {
    node.style.position = "relative";
  }
  node.style.overflow = "hidden"; // Contain sparkles

  node.addEventListener("mousemove", handleMouseMove);
  animationFrameId = requestAnimationFrame(updateSparkles);

  return {
    destroy() {
      node.removeEventListener("mousemove", handleMouseMove);
      cancelAnimationFrame(animationFrameId);
      sparkles.forEach((s) => s.element.remove());
      sparkles = [];
    },
  };
}
