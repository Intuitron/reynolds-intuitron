import React, { useState, useEffect, useRef, useCallback } from 'react';
import 'katex/dist/katex.min.css';
import katex from 'katex';

// ============================================================
// MODULE-LEVEL CONSTANTS
// ============================================================

const FLUIDS = {
  water: { name: 'Water (20°C)', density: 998, viscosity: 0.001002 },
  air: { name: 'Air (20°C)', density: 1.204, viscosity: 0.00001825 },
  oil: { name: 'Oil (SAE 30)', density: 870, viscosity: 0.29 },
  glycerin: { name: 'Glycerin (20°C)', density: 1260, viscosity: 1.412 },
  honey: { name: 'Honey', density: 1420, viscosity: 10.0 }
};

const VAR = {
  rho: { bright: '#10b981', deep: '#059669', name: 'ρ' },
  V:   { bright: '#0ea5e9', deep: '#0284c7', name: 'V' },
  D:   { bright: '#8b5cf6', deep: '#7c3aed', name: 'D' },
  mu:  { bright: '#f59e0b', deep: '#d97706', name: 'μ' }
};

// Slider range in log10(viscosity), Pa·s
const VISC_LOG_MIN = -5;
const VISC_LOG_MAX = 1;
const VISC_LOG_RANGE = VISC_LOG_MAX - VISC_LOG_MIN;

// Pre-computed fluid marker positions on the viscosity slider, sorted left → right.
// Alternating rows (top/bottom) handle label collisions in the cluster at the right
// (oil/glycerin/honey sit within ~25% of the slider's width of each other).
const FLUID_MARKERS = Object.entries(FLUIDS)
  .map(([key, fluid]) => {
    const logVisc = Math.log10(fluid.viscosity);
    const position = ((logVisc - VISC_LOG_MIN) / VISC_LOG_RANGE) * 100;
    return { key, label: fluid.name.split(' ')[0], position };
  })
  .sort((a, b) => a.position - b.position);

const Q = 9;
const LATTICE_WEIGHTS = [4/9, 1/9, 1/9, 1/9, 1/9, 1/36, 1/36, 1/36, 1/36];
const LATTICE_VELOCITIES = [
  [0, 0], [1, 0], [0, 1], [-1, 0], [0, -1],
  [1, 1], [-1, 1], [-1, -1], [1, -1]
];

const cardStyle = {
  background: '#ffffff',
  border: '2px solid #e5e5e5',
  borderRadius: '16px',
  padding: '1.5rem',
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)'
};

// ============================================================
// MODULE-LEVEL COMPONENTS
// ============================================================

const Chip = ({ varKey }) => {
  const v = VAR[varKey];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: '36px', height: '36px', borderRadius: '10px',
      background: v.bright + '15', border: `1.5px solid ${v.bright}50`,
      color: v.deep, fontWeight: 700, fontSize: '20px', fontStyle: 'italic',
      fontFamily: "'Times New Roman', 'KaTeX_Math', serif"
    }}>
      {v.name}
    </span>
  );
};

const SliderCard = React.memo(({ varKey, name, value, unit, sub, children }) => {
  const v = VAR[varKey];
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
        <Chip varKey={varKey} />
        <div style={{ fontSize: '13px', color: '#525252', fontWeight: 500 }}>{name}</div>
      </div>
      <div style={{
        fontSize: '24px', fontWeight: 600, color: v.deep,
        marginBottom: sub ? '2px' : '12px',
        letterSpacing: '-0.01em', lineHeight: 1.1
      }}>
        {value}
        <span style={{
          fontSize: '14px', color: '#a3a3a3', marginLeft: '6px', fontWeight: 500
        }}>{unit}</span>
      </div>
      {sub && (
        <div style={{
          fontSize: '12px', color: v.deep, marginBottom: '12px',
          fontStyle: 'italic', fontWeight: 500
        }}>{sub}</div>
      )}
      {children}
    </div>
  );
});

// Bespoke marker bar for the viscosity slider. Ticks sit at exact log positions;
// labels stagger between two rows to clear the oil/glycerin/honey cluster on the right.
// The active marker (when the slider settles near a preset) takes the amber colour
// identity from VAR.mu and bumps weight/size.
const FluidMarkerBar = ({ activeKey }) => (
  <div style={{ position: 'relative', height: '44px', marginTop: '6px' }}>
    {FLUID_MARKERS.map((marker, i) => {
      const isActive = activeKey === marker.key;
      const isTopRow = i % 2 === 0;
      const tickColor = isActive ? VAR.mu.bright : '#cbd5e1';
      const labelColor = isActive ? VAR.mu.deep : '#737373';

      return (
        <React.Fragment key={marker.key}>
          {/* Tick — always exactly at the marker's position */}
          <div style={{
            position: 'absolute',
            left: `${marker.position}%`,
            top: 0,
            transform: 'translateX(-50%)',
            width: isActive ? '3px' : '2px',
            height: '8px',
            background: tickColor,
            borderRadius: '1px',
            transition: 'background-color 0.15s ease, width 0.15s ease'
          }} />
          {/* Label — staggered into two rows, anchor adjusts at the edges */}
          <div style={{
            position: 'absolute',
            left: `${marker.position}%`,
            top: isTopRow ? '11px' : '27px',
            transform:
              marker.position < 6 ? 'translateX(0)' :
              marker.position > 94 ? 'translateX(-100%)' :
              'translateX(-50%)',
            fontSize: '10px',
            color: labelColor,
            fontWeight: isActive ? 600 : 400,
            whiteSpace: 'nowrap',
            transition: 'color 0.15s ease, font-weight 0.15s ease',
            letterSpacing: isActive ? '0.02em' : '0'
          }}>
            {marker.label}
          </div>
        </React.Fragment>
      );
    })}
  </div>
);

// ============================================================
// LATTICE BOLTZMANN SIMULATION
// ============================================================

class LatticeBoltzmann {
  constructor(width, height, viscosity, inletVelocity) {
    this.nx = width;
    this.ny = height;
    this.viscosity = viscosity;
    this.uInlet = inletVelocity;
    this.tau = 3 * viscosity + 0.5;
    this.omega = 1 / this.tau;

    this.f = Array(Q).fill(null).map(() =>
      Array(this.nx).fill(null).map(() => Array(this.ny).fill(0))
    );
    this.fTemp = Array(Q).fill(null).map(() =>
      Array(this.nx).fill(null).map(() => Array(this.ny).fill(0))
    );

    this.rho = Array(this.nx).fill(null).map(() => Array(this.ny).fill(1));
    this.ux = Array(this.nx).fill(null).map(() => Array(this.ny).fill(inletVelocity));
    this.uy = Array(this.nx).fill(null).map(() => Array(this.ny).fill(0));

    this.obstacle = Array(this.nx).fill(null).map(() => Array(this.ny).fill(false));

    this.initializeEquilibrium();
  }

  updateParams(viscosity, inletVelocity) {
    this.viscosity = viscosity;
    this.uInlet = inletVelocity;
    this.tau = 3 * viscosity + 0.5;
    this.omega = 1 / this.tau;
  }

  setObstacle(centerX, centerY, radius) {
    for (let x = 0; x < this.nx; x++) {
      for (let y = 0; y < this.ny; y++) {
        const dx = x - centerX;
        const dy = y - centerY;
        const wasObstacle = this.obstacle[x][y];
        const isObstacle = (dx * dx + dy * dy) <= (radius * radius);
        this.obstacle[x][y] = isObstacle;

        if (wasObstacle && !isObstacle) {
          this.rho[x][y] = 1;
          this.ux[x][y] = this.uInlet;
          this.uy[x][y] = 0;
          for (let i = 0; i < Q; i++) {
            this.f[i][x][y] = this.equilibrium(i, 1, this.uInlet, 0);
          }
        }
      }
    }
  }

  initializeEquilibrium() {
    for (let x = 0; x < this.nx; x++) {
      for (let y = 0; y < this.ny; y++) {
        const rho = this.rho[x][y];
        const ux = this.ux[x][y];
        const uy = this.uy[x][y];
        for (let i = 0; i < Q; i++) {
          this.f[i][x][y] = this.equilibrium(i, rho, ux, uy);
        }
      }
    }
  }

  equilibrium(i, rho, ux, uy) {
    const cx = LATTICE_VELOCITIES[i][0];
    const cy = LATTICE_VELOCITIES[i][1];
    const cu = cx * ux + cy * uy;
    const u2 = ux * ux + uy * uy;
    return LATTICE_WEIGHTS[i] * rho * (1 + 3 * cu + 4.5 * cu * cu - 1.5 * u2);
  }

  step() {
    for (let x = 0; x < this.nx; x++) {
      for (let y = 0; y < this.ny; y++) {
        if (this.obstacle[x][y]) continue;

        let rho = 0, ux = 0, uy = 0;
        for (let i = 0; i < Q; i++) {
          rho += this.f[i][x][y];
          ux += LATTICE_VELOCITIES[i][0] * this.f[i][x][y];
          uy += LATTICE_VELOCITIES[i][1] * this.f[i][x][y];
        }
        ux /= rho;
        uy /= rho;

        this.rho[x][y] = rho;
        this.ux[x][y] = ux;
        this.uy[x][y] = uy;

        for (let i = 0; i < Q; i++) {
          const feq = this.equilibrium(i, rho, ux, uy);
          this.f[i][x][y] -= this.omega * (this.f[i][x][y] - feq);
        }
      }
    }

    for (let x = 0; x < this.nx; x++) {
      for (let y = 0; y < this.ny; y++) {
        for (let i = 0; i < Q; i++) {
          const cx = LATTICE_VELOCITIES[i][0];
          const cy = LATTICE_VELOCITIES[i][1];
          const xNext = (x + cx + this.nx) % this.nx;
          const yNext = y + cy;
          if (yNext >= 0 && yNext < this.ny) {
            this.fTemp[i][xNext][yNext] = this.f[i][x][y];
          }
        }
      }
    }

    [this.f, this.fTemp] = [this.fTemp, this.f];
    this.applyBoundaryConditions();
  }

  applyBoundaryConditions() {
    for (let y = 0; y < this.ny; y++) {
      for (let i = 0; i < Q; i++) {
        this.f[i][0][y] = this.equilibrium(i, 1, this.uInlet, 0);
      }
    }

    for (let x = 0; x < this.nx; x++) {
      this.f[2][x][0] = this.f[4][x][0];
      this.f[5][x][0] = this.f[7][x][0];
      this.f[6][x][0] = this.f[8][x][0];
      this.f[4][x][this.ny-1] = this.f[2][x][this.ny-1];
      this.f[7][x][this.ny-1] = this.f[5][x][this.ny-1];
      this.f[8][x][this.ny-1] = this.f[6][x][this.ny-1];
    }

    for (let x = 0; x < this.nx; x++) {
      for (let y = 0; y < this.ny; y++) {
        if (this.obstacle[x][y]) {
          const temp = [...this.f.map(fi => fi[x][y])];
          this.f[1][x][y] = temp[3];
          this.f[3][x][y] = temp[1];
          this.f[2][x][y] = temp[4];
          this.f[4][x][y] = temp[2];
          this.f[5][x][y] = temp[7];
          this.f[7][x][y] = temp[5];
          this.f[6][x][y] = temp[8];
          this.f[8][x][y] = temp[6];
        }
      }
    }
  }

  getVorticity(x, y) {
    if (x <= 0 || x >= this.nx - 1 || y <= 0 || y >= this.ny - 1) return 0;
    const dudy = (this.ux[x][y+1] - this.ux[x][y-1]) / 2;
    const dvdx = (this.uy[x+1][y] - this.uy[x-1][y]) / 2;
    return dvdx - dudy;
  }
}

// ============================================================
// MAIN COMPONENT
// ============================================================

const INITIAL_VISC_LOG = Math.log10(0.001002);

const ReynoldsIntuitron = () => {
  const [viscosityLog, setViscosityLog] = useState(INITIAL_VISC_LOG);
  const [density, setDensity] = useState(998);
  const [velocity, setVelocity] = useState(1.0);
  const [diameter, setDiameter] = useState(0.05);

  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const lbmRef = useRef(null);
  const particlesRef = useRef([]);
  const equationRef = useRef(null);

  const liveValuesRef = useRef({
    viscosityLog: INITIAL_VISC_LOG,
    density: 998,
    velocity: 1.0,
    diameter: 0.05
  });
  const paramsRef = useRef({
    viscosity: Math.pow(10, INITIAL_VISC_LOG),
    density: 998,
    velocity: 1.0,
    diameter: 0.05
  });
  const prevDiameterRef = useRef(0.05);
  const regimeColorRef = useRef('#3b82f6');
  const rafCommitRef = useRef(null);

  const scheduleCommit = useCallback(() => {
    if (rafCommitRef.current !== null) return;
    rafCommitRef.current = requestAnimationFrame(() => {
      rafCommitRef.current = null;
      const lv = liveValuesRef.current;
      setViscosityLog(lv.viscosityLog);
      setDensity(lv.density);
      setVelocity(lv.velocity);
      setDiameter(lv.diameter);
    });
  }, []);

  const handleViscosity = useCallback((e) => {
    const val = parseFloat(e.target.value);
    liveValuesRef.current.viscosityLog = val;
    paramsRef.current.viscosity = Math.pow(10, val);
    scheduleCommit();
  }, [scheduleCommit]);

  const handleDensity = useCallback((e) => {
    const val = parseFloat(e.target.value);
    liveValuesRef.current.density = val;
    paramsRef.current.density = val;
    scheduleCommit();
  }, [scheduleCommit]);

  const handleVelocity = useCallback((e) => {
    const val = parseFloat(e.target.value);
    liveValuesRef.current.velocity = val;
    paramsRef.current.velocity = val;
    scheduleCommit();
  }, [scheduleCommit]);

  const handleDiameter = useCallback((e) => {
    const val = parseFloat(e.target.value);
    liveValuesRef.current.diameter = val;
    paramsRef.current.diameter = val;
    scheduleCommit();
  }, [scheduleCommit]);

  useEffect(() => () => {
    if (rafCommitRef.current !== null) {
      cancelAnimationFrame(rafCommitRef.current);
    }
  }, []);

  const viscosity = Math.pow(10, viscosityLog);

  const findClosestFluid = (visc) => {
    let closest = null;
    let minDiff = Infinity;
    Object.entries(FLUIDS).forEach(([key, fluid]) => {
      const diff = Math.abs(Math.log10(fluid.viscosity) - Math.log10(visc));
      if (diff < minDiff) {
        minDiff = diff;
        closest = { key, ...fluid, diff };
      }
    });
    return closest;
  };

  const closestFluid = findClosestFluid(viscosity);
  const isNearFluid = closestFluid.diff < 0.15;
  const activeFluidKey = isNearFluid ? closestFluid.key : null;

  useEffect(() => {
    if (isNearFluid) {
      setDensity(closestFluid.density);
      liveValuesRef.current.density = closestFluid.density;
      paramsRef.current.density = closestFluid.density;
    }
  }, [isNearFluid, closestFluid.density]);

  const Re = (density * velocity * diameter) / viscosity;

  const getRegime = (re) => {
    if (re < 2300) return { name: 'Laminar', color: '#3b82f6', position: (re / 2300) * 33.33 };
    if (re < 4000) return { name: 'Transitional', color: '#f59e0b', position: 33.33 + ((re - 2300) / 1700) * 33.33 };
    return { name: 'Turbulent', color: '#ef4444', position: 66.66 + Math.min((re - 4000) / 6000, 1) * 33.34 };
  };

  const regime = getRegime(Re);
  const frictionFactor = Re < 2300 ? 64 / Re : 0.316 / Math.pow(Re, 0.25);
  const pressureDrop = frictionFactor * (1 / diameter) * (density * velocity * velocity) / 2;

  const getRegimeDescription = () => {
    if (Re < 2300) {
      return {
        characteristics: ['Symmetric, attached flow', 'No flow separation', 'Viscous forces dominate'],
        applications: ['Microfluidic devices', 'Blood flow', 'Creeping flow'],
        notes: 'Flow wraps smoothly around the cylinder with perfect symmetry'
      };
    } else if (Re < 4000) {
      return {
        characteristics: ['Asymmetric wake forms', 'Flow separation begins', 'Wake starts to oscillate'],
        applications: ['Low-speed aerodynamics', 'Settling particles', 'Transitional flows'],
        notes: 'Inertial forces begin to compete with viscosity - watch the wake destabilize'
      };
    } else {
      return {
        characteristics: ['Vortex shedding', 'Von Kármán vortex street', 'Periodic oscillations'],
        applications: ['Wind loading on structures', 'Flow-induced vibrations', 'Turbulent mixing'],
        notes: 'Inertia dominates - vortices peel off alternately creating the famous vortex street'
      };
    }
  };

  const description = getRegimeDescription();

  regimeColorRef.current = regime.color;

  useEffect(() => {
    if (equationRef.current) {
      const equation = String.raw`Re = \frac{\textcolor{${VAR.rho.bright}}{\rho}\,\textcolor{${VAR.V.bright}}{V}\,\textcolor{${VAR.D.bright}}{D}}{\textcolor{${VAR.mu.bright}}{\mu}}`;
      katex.render(equation, equationRef.current, {
        displayMode: true,
        throwOnError: false
      });
    }
  }, []);

  // LBM simulation with offscreen-canvas vorticity caching to eliminate flicker.
  // Vorticity field is expensive to compute (192k pixel writes per refresh) so we only
  // recompute it every 2 frames. The previous fix cleared the main canvas every frame
  // but only wrote vorticity every other frame, which strobed at 30Hz. By caching
  // the field on an offscreen canvas and blitting it every frame, vorticity displays
  // continuously while compute load stays the same.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // Offscreen canvas holds the most recent vorticity field between recomputes
    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = width;
    offscreenCanvas.height = height;
    const offscreenCtx = offscreenCanvas.getContext('2d');

    const gridWidth = 200;
    const gridHeight = 80;
    const pixelsPerCell = width / gridWidth;

    const cylinderX = Math.floor(gridWidth * 0.25);
    const cylinderY = Math.floor(gridHeight / 2);

    const initialParams = paramsRef.current;
    const initialKinViscosity = initialParams.viscosity / initialParams.density;
    const initialLatticeViscosity = 0.01 + (initialKinViscosity / 0.001) * 0.05;
    const initialLatticeVelocity = Math.min(0.15, initialParams.velocity * 0.05);

    lbmRef.current = new LatticeBoltzmann(
      gridWidth, gridHeight,
      initialLatticeViscosity, initialLatticeVelocity
    );

    const initialRadius = (initialParams.diameter / 0.1) * 8;
    lbmRef.current.setObstacle(cylinderX, cylinderY, initialRadius);
    prevDiameterRef.current = initialParams.diameter;

    particlesRef.current = [];
    for (let i = 0; i < 250; i++) {
      particlesRef.current.push({
        x: Math.random() * gridWidth,
        y: Math.random() * gridHeight,
        history: [],
        life: Math.random() * 400 + 200
      });
    }

    let frameCount = 0;

    const animate = () => {
      const params = paramsRef.current;

      const kinViscosity = params.viscosity / params.density;
      const latticeViscosity = 0.01 + (kinViscosity / 0.001) * 0.05;
      const latticeVelocity = Math.min(0.15, params.velocity * 0.05);
      lbmRef.current.updateParams(latticeViscosity, latticeVelocity);

      if (params.diameter !== prevDiameterRef.current) {
        const newRadius = (params.diameter / 0.1) * 8;
        lbmRef.current.setObstacle(cylinderX, cylinderY, newRadius);
        prevDiameterRef.current = params.diameter;
      }

      for (let step = 0; step < 3; step++) {
        lbmRef.current.step();
      }

      frameCount++;

      // Clear main canvas every frame (dark background)
      ctx.fillStyle = '#0a0f1a';
      ctx.fillRect(0, 0, width, height);

      // Recompute and cache vorticity onto offscreen canvas every 2 frames
      if (frameCount % 2 === 0) {
        const imageData = offscreenCtx.createImageData(width, height);
        const data = imageData.data;

        for (let x = 0; x < gridWidth; x++) {
          for (let y = 0; y < gridHeight; y++) {
            const vorticity = lbmRef.current.getVorticity(x, y);
            const vorticityMag = Math.abs(vorticity);

            let r, g, b;
            if (vorticity > 0) {
              const intensity = Math.min(1, vorticityMag * 30);
              r = Math.floor(255 * intensity);
              g = Math.floor(50 * intensity);
              b = Math.floor(255 * intensity);
            } else {
              const intensity = Math.min(1, vorticityMag * 30);
              r = Math.floor(150 * intensity);
              g = Math.floor(255 * intensity);
              b = Math.floor(50 * intensity);
            }

            for (let px = 0; px < pixelsPerCell; px++) {
              for (let py = 0; py < pixelsPerCell; py++) {
                const pixelX = Math.floor(x * pixelsPerCell + px);
                const pixelY = Math.floor(y * pixelsPerCell + py);
                if (pixelX < width && pixelY < height) {
                  const idx = (pixelY * width + pixelX) * 4;
                  data[idx] = r;
                  data[idx + 1] = g;
                  data[idx + 2] = b;
                  data[idx + 3] = 130;
                }
              }
            }
          }
        }
        offscreenCtx.putImageData(imageData, 0, 0);
      }

      // Blit cached vorticity onto main canvas every frame — no strobe
      ctx.drawImage(offscreenCanvas, 0, 0);

      // Cylinder drawn fresh every frame on top of vorticity
      const currentRadius = (params.diameter / 0.1) * 8;
      ctx.fillStyle = '#1e293b';
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(
        cylinderX * pixelsPerCell,
        cylinderY * pixelsPerCell,
        currentRadius * pixelsPerCell,
        0, Math.PI * 2
      );
      ctx.fill();
      ctx.stroke();

      // Particles also drawn fresh every frame (they move every frame)
      const particleColor = regimeColorRef.current;
      particlesRef.current.forEach((particle) => {
        particle.life -= 1;

        const gridX = Math.floor(particle.x);
        const gridY = Math.floor(particle.y);

        const onObstacle = (gridX >= 0 && gridX < gridWidth && gridY >= 0 && gridY < gridHeight)
          ? lbmRef.current.obstacle[gridX][gridY] : false;

        if (particle.x > gridWidth || particle.x < 0 || particle.life <= 0 || onObstacle) {
          particle.x = Math.random() * 3;
          particle.y = 5 + Math.random() * (gridHeight - 10);
          particle.history = [];
          particle.life = Math.random() * 400 + 200;
          return;
        }

        if (gridX >= 0 && gridX < gridWidth && gridY >= 0 && gridY < gridHeight) {
          const ux = lbmRef.current.ux[gridX][gridY];
          const uy = lbmRef.current.uy[gridX][gridY];

          particle.x += ux * 10;
          particle.y += uy * 10;

          if (particle.y < 1) particle.y = 1;
          if (particle.y > gridHeight - 1) particle.y = gridHeight - 1;

          particle.history.push({ x: particle.x, y: particle.y });
          if (particle.history.length > 25) {
            particle.history.shift();
          }
        }

        if (particle.history.length > 1) {
          ctx.strokeStyle = particleColor;
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = 0.5;

          ctx.beginPath();
          ctx.moveTo(
            particle.history[0].x * pixelsPerCell,
            particle.history[0].y * pixelsPerCell
          );
          for (let i = 1; i < particle.history.length; i++) {
            ctx.lineTo(
              particle.history[i].x * pixelsPerCell,
              particle.history[i].y * pixelsPerCell
            );
          }
          ctx.stroke();
          ctx.globalAlpha = 1;
        }

        ctx.fillStyle = particleColor;
        ctx.beginPath();
        ctx.arc(
          particle.x * pixelsPerCell,
          particle.y * pixelsPerCell,
          2.5, 0, Math.PI * 2
        );
        ctx.fill();
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      particlesRef.current = [];
    };
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f5f5f5',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      color: '#171717',
      padding: '1.5rem'
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        
        input[type="range"] {
          width: 100%;
          cursor: pointer;
          height: 6px;
          -webkit-appearance: none;
          appearance: none;
          background: transparent;
          touch-action: none;
        }
        
        input[type="range"]::-webkit-slider-runnable-track {
          height: 6px;
          border-radius: 3px;
          background: #e5e5e5;
        }
        
        input[type="range"]::-moz-range-track {
          height: 6px;
          border-radius: 3px;
          background: #e5e5e5;
        }
        
        input[type="range"].rho::-webkit-slider-thumb {
          -webkit-appearance: none;
          height: 20px; width: 20px; border-radius: 50%;
          background: ${VAR.rho.bright}; margin-top: -7px; cursor: pointer;
          box-shadow: 0 2px 6px ${VAR.rho.bright}50; border: 2px solid white;
        }
        input[type="range"].vel::-webkit-slider-thumb {
          -webkit-appearance: none;
          height: 20px; width: 20px; border-radius: 50%;
          background: ${VAR.V.bright}; margin-top: -7px; cursor: pointer;
          box-shadow: 0 2px 6px ${VAR.V.bright}50; border: 2px solid white;
        }
        input[type="range"].dia::-webkit-slider-thumb {
          -webkit-appearance: none;
          height: 20px; width: 20px; border-radius: 50%;
          background: ${VAR.D.bright}; margin-top: -7px; cursor: pointer;
          box-shadow: 0 2px 6px ${VAR.D.bright}50; border: 2px solid white;
        }
        input[type="range"].mu::-webkit-slider-thumb {
          -webkit-appearance: none;
          height: 20px; width: 20px; border-radius: 50%;
          background: ${VAR.mu.bright}; margin-top: -7px; cursor: pointer;
          box-shadow: 0 2px 6px ${VAR.mu.bright}50; border: 2px solid white;
        }
        
        .katex { font-size: 2rem !important; }
        .katex-display { margin: 0 !important; }
        
        @media (max-width: 1100px) {
          .equation-result-row { grid-template-columns: 1fr !important; }
          .slider-row { grid-template-columns: 1fr 1fr !important; }
        }
        @media (max-width: 640px) {
          .slider-row { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <div style={{ maxWidth: '1600px', margin: '0 auto' }}>

        <header style={{
          ...cardStyle,
          textAlign: 'center',
          marginBottom: '1.5rem',
          padding: '1.25rem 2rem'
        }}>
          <h1 style={{
            margin: '0 0 0.25rem',
            fontSize: '26px',
            fontWeight: 700,
            color: '#171717',
            letterSpacing: '-0.02em'
          }}>
            Reynolds Number Calculator
          </h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#525252' }}>
            Lattice Boltzmann simulation of flow around a cylinder
          </p>
        </header>

        <div style={{
          background: '#0a0f1a',
          border: '2px solid #1e293b',
          borderRadius: '16px',
          padding: '1.25rem',
          marginBottom: '1.5rem',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)'
        }}>
          <canvas
            ref={canvasRef}
            width={1500}
            height={500}
            style={{
              width: '100%',
              height: 'auto',
              display: 'block',
              borderRadius: '10px'
            }}
          />
          <div style={{
            marginTop: '0.75rem',
            textAlign: 'center',
            fontSize: '13px',
            color: 'rgba(255,255,255,0.55)',
            lineHeight: 1.5
          }}>
            {Re < 40 && 'Viscosity dominates — flow wraps smoothly around the cylinder'}
            {Re >= 40 && Re < 200 && 'The wake is destabilising behind the cylinder'}
            {Re >= 200 && 'Vortices shedding — the famous von Kármán vortex street!'}
            <br />
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
              Vorticity: <span style={{ color: '#ff50ff' }}>magenta = clockwise</span>, <span style={{ color: '#96ff32' }}>lime = anti-clockwise</span>
            </span>
          </div>
        </div>

        <div className="equation-result-row" style={{
          display: 'grid',
          gridTemplateColumns: '1.4fr 1fr',
          gap: '1.5rem',
          marginBottom: '1.5rem'
        }}>

          <div style={{
            ...cardStyle,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            textAlign: 'center',
            padding: '1.25rem 1.5rem'
          }}>
            <div style={{
              fontSize: '11px',
              color: '#a3a3a3',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              marginBottom: '0.75rem'
            }}>
              Governing Equation
            </div>
            <div ref={equationRef} />
            <div style={{
              marginTop: '0.75rem',
              fontSize: '12px',
              color: '#525252',
              maxWidth: '440px',
              lineHeight: 1.5
            }}>
              The ratio of inertial forces to viscous forces — the single dimensionless number that determines flow behaviour
            </div>
          </div>

          <div style={{
            ...cardStyle,
            padding: '1.25rem 1.5rem',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{ textAlign: 'center', marginBottom: '0.75rem' }}>
              <div style={{
                fontSize: '11px',
                color: '#a3a3a3',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                marginBottom: '0.5rem'
              }}>
                Reynolds Number
              </div>
              <div style={{
                fontSize: '52px',
                fontWeight: 700,
                color: regime.color,
                lineHeight: 1,
                letterSpacing: '-0.04em',
                marginBottom: '0.5rem',
                fontVariantNumeric: 'tabular-nums'
              }}>
                {Re < 1 ? Re.toFixed(2) : Re.toFixed(0)}
              </div>
              <div style={{
                fontSize: '14px',
                fontWeight: 600,
                color: regime.color,
                padding: '4px 14px',
                background: regime.color + '15',
                borderRadius: '20px',
                display: 'inline-block',
                letterSpacing: '0.02em'
              }}>
                {regime.name}
              </div>
            </div>

            <div style={{
              marginTop: 'auto',
              paddingTop: '0.75rem',
              borderTop: '2px solid #f5f5f5',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '1rem'
            }}>
              <div>
                <div style={{
                  fontSize: '10px', color: '#a3a3a3', fontWeight: 600,
                  textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '2px'
                }}>
                  Friction f
                </div>
                <div style={{ fontSize: '16px', fontWeight: 600, color: '#171717', fontVariantNumeric: 'tabular-nums' }}>
                  {frictionFactor.toFixed(4)}
                </div>
              </div>
              <div>
                <div style={{
                  fontSize: '10px', color: '#a3a3a3', fontWeight: 600,
                  textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '2px'
                }}>
                  Pressure Drop
                </div>
                <div style={{ fontSize: '16px', fontWeight: 600, color: '#171717', fontVariantNumeric: 'tabular-nums' }}>
                  {pressureDrop.toFixed(0)} <span style={{ fontSize: '12px', color: '#a3a3a3', fontWeight: 500 }}>Pa/m</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="slider-row" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '1rem',
          marginBottom: '1.5rem'
        }}>

          <SliderCard
            varKey="rho"
            name="Density"
            value={density.toFixed(0)}
            unit="kg/m³"
            sub={isNearFluid ? `≈ ${closestFluid.name}` : null}
          >
            <input
              type="range"
              className="rho"
              min="1"
              max="1500"
              step="1"
              value={density}
              onChange={handleDensity}
              disabled={isNearFluid}
              style={{ opacity: isNearFluid ? 0.5 : 1 }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#a3a3a3', marginTop: '8px' }}>
              <span>1</span><span>1500</span>
            </div>
          </SliderCard>

          <SliderCard
            varKey="V"
            name="Velocity"
            value={velocity.toFixed(2)}
            unit="m/s"
          >
            <input
              type="range"
              className="vel"
              min="0.01"
              max="10"
              step="0.01"
              value={velocity}
              onChange={handleVelocity}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#a3a3a3', marginTop: '8px' }}>
              <span>0.01</span><span>10</span>
            </div>
          </SliderCard>

          <SliderCard
            varKey="D"
            name="Cylinder Diameter"
            value={(diameter * 1000).toFixed(0)}
            unit="mm"
          >
            <input
              type="range"
              className="dia"
              min="0.001"
              max="0.125"
              step="0.001"
              value={diameter}
              onChange={handleDiameter}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#a3a3a3', marginTop: '8px' }}>
              <span>1 mm</span><span>125 mm</span>
            </div>
          </SliderCard>

          {/* Viscosity slider: log scale, with staggered fluid markers replacing min/max */}
          <SliderCard
            varKey="mu"
            name="Viscosity"
            value={viscosity.toExponential(2)}
            unit="Pa·s"
          >
            <input
              type="range"
              className="mu"
              min={VISC_LOG_MIN}
              max={VISC_LOG_MAX}
              step="0.02"
              value={viscosityLog}
              onChange={handleViscosity}
            />
            <FluidMarkerBar activeKey={activeFluidKey} />
          </SliderCard>
        </div>

        <div style={{ ...cardStyle, padding: '1.5rem 2rem' }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1.25rem'
          }}>
            <div>
              <div style={{
                fontSize: '11px',
                color: '#a3a3a3',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                marginBottom: '4px'
              }}>
                Flow Regime
              </div>
              <div style={{ fontSize: '20px', fontWeight: 600, color: regime.color }}>
                {regime.name}
              </div>
            </div>
            <div style={{
              fontSize: '13px',
              color: '#525252',
              fontStyle: 'italic',
              textAlign: 'right',
              maxWidth: '500px'
            }}>
              {description.notes}
            </div>
          </div>

          <div style={{ position: 'relative', marginBottom: '1.5rem' }}>
            <div style={{
              height: '54px',
              borderRadius: '10px',
              overflow: 'hidden',
              display: 'flex',
              border: '2px solid #e5e5e5'
            }}>
              <div style={{
                flex: '1',
                background: 'linear-gradient(135deg, #1e40af, #3b82f6)',
                position: 'relative'
              }}>
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: '0.85rem', fontWeight: 600, color: 'white' }}>Laminar</div>
                <div style={{ position: 'absolute', bottom: '3px', left: '50%', transform: 'translateX(-50%)', fontSize: '0.65rem', color: 'rgba(255,255,255,0.85)' }}>Re &lt; 2,300</div>
              </div>
              <div style={{
                flex: '1',
                background: 'linear-gradient(135deg, #f59e0b, #fb923c)',
                position: 'relative'
              }}>
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: '0.85rem', fontWeight: 600, color: 'white' }}>Transitional</div>
                <div style={{ position: 'absolute', bottom: '3px', left: '50%', transform: 'translateX(-50%)', fontSize: '0.65rem', color: 'rgba(255,255,255,0.85)' }}>2,300 - 4,000</div>
              </div>
              <div style={{
                flex: '1',
                background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                position: 'relative'
              }}>
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: '0.85rem', fontWeight: 600, color: 'white' }}>Turbulent</div>
                <div style={{ position: 'absolute', bottom: '3px', left: '50%', transform: 'translateX(-50%)', fontSize: '0.65rem', color: 'rgba(255,255,255,0.85)' }}>Re &gt; 4,000</div>
              </div>
            </div>

            <div style={{
              position: 'absolute',
              top: '-9px',
              left: `${regime.position}%`,
              transform: 'translateX(-50%)',
              transition: 'left 0.15s ease'
            }}>
              <div style={{
                width: 0, height: 0,
                borderLeft: '10px solid transparent',
                borderRight: '10px solid transparent',
                borderTop: `14px solid ${regime.color}`,
                filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.25))'
              }} />
            </div>
            <div style={{
              position: 'absolute',
              bottom: '-9px',
              left: `${regime.position}%`,
              transform: 'translateX(-50%)',
              transition: 'left 0.15s ease'
            }}>
              <div style={{
                width: 0, height: 0,
                borderLeft: '10px solid transparent',
                borderRight: '10px solid transparent',
                borderBottom: `14px solid ${regime.color}`,
                filter: 'drop-shadow(0 -2px 4px rgba(0,0,0,0.25))'
              }} />
            </div>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '2rem',
            fontSize: '13px',
            paddingTop: '1.25rem',
            borderTop: '2px solid #f5f5f5'
          }}>
            <div>
              <div style={{
                fontSize: '11px',
                color: '#a3a3a3',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                marginBottom: '0.6rem'
              }}>Characteristics</div>
              {description.characteristics.map((char, i) => (
                <div key={i} style={{ color: '#525252', marginBottom: '0.25rem', lineHeight: 1.5 }}>
                  • {char}
                </div>
              ))}
            </div>
            <div>
              <div style={{
                fontSize: '11px',
                color: '#a3a3a3',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                marginBottom: '0.6rem'
              }}>Applications</div>
              {description.applications.map((app, i) => (
                <div key={i} style={{ color: '#525252', marginBottom: '0.25rem', lineHeight: 1.5 }}>
                  • {app}
                </div>
              ))}
            </div>
          </div>
        </div>

        <footer style={{
          marginTop: '2rem',
          textAlign: 'center',
          fontSize: '12px',
          color: '#a3a3a3'
        }}>
          <div>Intuitron — Interactive Engineering Education</div>
          <div style={{ marginTop: '4px' }}>
            Real fluid dynamics powered by the Lattice Boltzmann Method
          </div>
        </footer>
      </div>
    </div>
  );
};

export default ReynoldsIntuitron;
