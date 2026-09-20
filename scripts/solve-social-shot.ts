// Finds a deterministic, visually useful one-putt for the social recorder.
// Uses the exact production course/green/physics builders; no copied physics.
import { CONFIG } from '../src/config.ts';
import { buildHoleGreen, buildHoleRoller, tourHoleCourse, tourHoleSetup } from '../src/course/hole-build.ts';
import { tourById } from '../src/course/tour-holes.ts';

const tour = tourById('beginner');
const seed = Number(process.argv[2] ?? 1038) >>> 0;
const course = tourHoleCourse(tour, seed);
const setup = tourHoleSetup(tour, seed);
const green = buildHoleGreen(course, setup);
const direct = Math.atan2(course.cup.x - course.tee.x, -(course.cup.z - course.tee.z));
const P = CONFIG.physics;

let best: { speed: number; direction: number; elapsed: number; distance: number } | null = null;
// Fine enough to reliably catch the cup while still completing quickly in Actions.
for (let deg = -18; deg <= 18; deg += 0.25) {
  const direction = direct + (deg * Math.PI) / 180;
  for (let speed = 1.0; speed <= 7.0; speed += 0.025) {
    const roller = buildHoleRoller(green, course, setup);
    roller.launch(course.tee.x, course.tee.z, speed, direction);
    let steps = 0;
    while (roller.status === 'rolling' && steps++ < 240 * 30) roller.advance(P.timeStep);
    if (roller.status !== 'holed') continue;
    const hit = { speed, direction, elapsed: roller.elapsed, distance: roller.distance };
    // Prefer a shot that visibly rolls for a while, but avoid very slow clips.
    if (!best || Math.abs(hit.elapsed - 4.2) < Math.abs(best.elapsed - 4.2)) best = hit;
  }
}
if (!best) throw new Error(`No one-putt solution found for seed ${seed}`);
process.stdout.write(JSON.stringify({ seed, par: course.par, ...best }));
