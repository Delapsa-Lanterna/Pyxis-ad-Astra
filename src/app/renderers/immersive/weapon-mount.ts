import { weaponMountShapes } from '@/domain/immersive/weapon-icon';

export function drawWeaponMount(context: CanvasRenderingContext2D, type: string, size: string, opacity = 1) {
  context.save();
  for (const shape of weaponMountShapes(type, size)) {
    context.fillStyle = shape.color;
    context.globalAlpha = shape.alpha * opacity;
    for (let pass = 0; pass < 3; pass++) {
      const radius = shape.radius - pass * 0.25,
        thickness = 3.5 - pass * 0.5;
      context.beginPath();
      if (shape.kind === 'circle') {
        context.arc(0, 0, radius, 0, Math.PI * 2);
        context.arc(0, 0, radius - thickness, 0, Math.PI * 2, true);
      } else if (shape.kind === 'square') {
        context.rect(-radius, -radius, radius * 2, radius * 2);
        context.rect(-radius + thickness, -radius + thickness, (radius - thickness) * 2, (radius - thickness) * 2);
      } else {
        for (const inset of [0, thickness * 1.414]) {
          const r = radius - inset;
          context.moveTo(-r, 0);
          context.lineTo(0, r);
          context.lineTo(r, 0);
          context.lineTo(0, -r);
          context.closePath();
        }
      }
      context.fill('evenodd');
    }
  }
  context.restore();
}
