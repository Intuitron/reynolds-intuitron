import React, { useState, useEffect, useRef } from 'react';

const FLUIDS = {
  water: { name: 'Water (20°C)', density: 998, viscosity: 0.001002 },
  air: { name: 'Air (20°C)', density: 1.204, viscosity: 0.00001825 },
  oil: { name: 'Oil (SAE 30)', density: 870, viscosity: 0.29 },
  glycerin: { name: 'Glycerin (20°C)', density: 1260, viscosity: 1.412 },
  honey: { name: 'Honey', density: 1420, viscosity: 10.0 }
};

// D2Q9 Lattice Boltzmann constants
const Q = 9;
const LATTICE_WEIGHTS = [4/9, 1/9, 1/9, 1/9, 1/9, 1/36, 1/36, 1/36, 1/36];
const LATTICE_VELOCITIES = [
  [0, 0],   // 0: rest
  [1, 0],   // 1: east
  [0, 1],   // 2: north
  [-1, 0],  // 3: west
  [0, -1],  // 4: south
  [1, 1],   // 5: northeast
  [-1, 1],  // 6: northwest
  [-1, -1], // 7: southwest
  [1, -1]   // 8: southeast
];

class LatticeBoltzmann {
  constructor(width, height, viscosity, inletVelocity) {
    this.nx = width;
    this.ny = height;
    this.viscosity = viscosity;
    this.uInlet = inletVelocity;
    
    // Relaxation parameter (related to viscosity)
    this.tau = 3 * viscosity + 0.5;
    this.omega = 1 / this.tau;
    
    // Distribution functions (current and temporary)
    this.f = Array(Q).fill(null).map(() => 
      Array(this.nx).fill(null).map(() => Array(this.ny).fill(0))
    );
    this.fTemp = Array(Q).fill(null).map(() => 
      Array(this.nx).fill(null).map(() => Array(this.ny).fill(0))
    );
    
    // Macroscopic variables
    this.rho = Array(this.nx).fill(null).map(() => Array(this.ny).fill(1));
    this.ux = Array(this.nx).fill(null).map(() => Array(this.ny).fill(inletVelocity));
    this.uy = Array(this.nx).fill(null).map(() => Array(this.ny).fill(0));
    
    // Obstacle mask
    this.obstacle = Array(this.nx).fill(null).map(() => Array(this.ny).fill(false));
    
    // Initialize equilibrium distribution
    this.initializeEquilibrium();
  }
  
  setObstacle(centerX, centerY, radius) {
    for (let x = 0; x < this.nx; x++) {
      for (let y = 0; y < this.ny; y++) {
        const dx = x - centerX;
        const dy = y - centerY;
        this.obstacle[x][y] = (dx * dx + dy * dy) <= (radius * radius);
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
    
    return LATTICE_WEIGHTS[i] * rho * (
      1 + 3 * cu + 4.5 * cu * cu - 1.5 * u2
    );
  }
  
  step() {
    // Collision step
    for (let x = 0; x < this.nx; x++) {
      for (let y = 0; y < this.ny; y++) {
        if (this.obstacle[x][y]) continue;
        
        // Calculate macroscopic variables
        let rho = 0;
        let ux = 0;
        let uy = 0;
        
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
        
        // Collision (BGK approximation)
        for (let i = 0; i < Q; i++) {
          const feq = this.equilibrium(i, rho, ux, uy);
          this.f[i][x][y] -= this.omega * (this.f[i][x][y] - feq);
        }
      }
    }
    
    // Streaming step
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
    
    // Swap distributions
    [this.f, this.fTemp] = [this.fTemp, this.f];
    
    // Boundary conditions
    this.applyBoundaryConditions();
  }
  
  applyBoundaryConditions() {
    // Inlet (left): constant velocity
    for (let y = 0; y < this.ny; y++) {
      const rho = 1;
      const ux = this.uInlet;
      const uy = 0;
      
      for (let i = 0; i < Q; i++) {
        this.f[i][0][y] = this.equilibrium(i, rho, ux, uy);
      }
    }
    
    // Top and bottom walls: bounce-back
    for (let x = 0; x < this.nx; x++) {
      // Bottom wall (y = 0)
      this.f[2][x][0] = this.f[4][x][0];
      this.f[5][x][0] = this.f[7][x][0];
      this.f[6][x][0] = this.f[8][x][0];
      
      // Top wall (y = ny-1)
      this.f[4][x][this.ny-1] = this.f[2][x][this.ny-1];
      this.f[7][x][this.ny-1] = this.f[5][x][this.ny-1];
      this.f[8][x][this.ny-1] = this.f[6][x][this.ny-1];
    }
    
    // Obstacle: bounce-back
    for (let x = 0; x < this.nx; x++) {
      for (let y = 0; y < this.ny; y++) {
        if (this.obstacle[x][y]) {
          // Reverse all velocities
          const temp = [...this.f.map(fi => fi[x][y])];
          this.f[1][x][y] = temp[3]; // east <-> west
          this.f[3][x][y] = temp[1];
          this.f[2][x][y] = temp[4]; // north <-> south
          this.f[4][x][y] = temp[2];
          this.f[5][x][y] = temp[7]; // NE <-> SW
          this.f[7][x][y] = temp[5];
          this.f[6][x][y] = temp[8]; // NW <-> SE
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

const ReynoldsIntuitron = () => {
  // Log scale for viscosity: 10^-5 to 10^1
  const [viscosityLog, setViscosityLog] = useState(Math.log10(0.001002)); // Start with water
  const [density, setDensity] = useState(998); // Water density
  const [velocity, setVelocity] = useState(1.0);
  const [diameter, setDiameter] = useState(0.05);
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const lbmRef = useRef(null);
  const particlesRef = useRef([]);

  const viscosity = Math.pow(10, viscosityLog);
  
  // Find closest fluid preset
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
  const isNearFluid = closestFluid.diff < 0.15; // Within ~40% on log scale
  
  // Auto-update density when near a known fluid
  useEffect(() => {
    if (isNearFluid) {
      setDensity(closestFluid.density);
    }
  }, [isNearFluid, closestFluid.density]);
  
  // Reynolds number based on cylinder diameter
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    // LBM grid resolution
    const gridWidth = 200;
    const gridHeight = 80;
    const pixelsPerCell = width / gridWidth;
    
    // Cylinder properties (proportional to diameter)
    const cylinderRadius = (diameter / 0.1) * 8; // Scale to grid units
    const cylinderX = Math.floor(gridWidth * 0.25);
    const cylinderY = Math.floor(gridHeight / 2);
    
    // Convert physical parameters to lattice units
    const kinematicViscosity = viscosity / density;
    const latticeViscosity = 0.01 + (kinematicViscosity / 0.001) * 0.05; // Scale to stable range
    const latticeVelocity = Math.min(0.15, velocity * 0.05); // Keep below 0.2 for stability
    
    // Initialize LBM
    lbmRef.current = new LatticeBoltzmann(gridWidth, gridHeight, latticeViscosity, latticeVelocity);
    lbmRef.current.setObstacle(cylinderX, cylinderY, cylinderRadius);
    
    // Initialize tracer particles
    if (particlesRef.current.length === 0) {
      for (let i = 0; i < 200; i++) {
        particlesRef.current.push({
          x: Math.random() * gridWidth,
          y: Math.random() * gridHeight,
          history: []
        });
      }
    }

    let frameCount = 0;

    const animate = () => {
      // Step LBM multiple times per frame for stability
      for (let step = 0; step < 3; step++) {
        lbmRef.current.step();
      }
      
      frameCount++;
      
      // Draw background
      ctx.fillStyle = '#0a0f1a';
      ctx.fillRect(0, 0, width, height);
      
      // Draw vorticity field (every few frames for performance)
      if (frameCount % 2 === 0) {
        const imageData = ctx.createImageData(width, height);
        const data = imageData.data;
        
        for (let x = 0; x < gridWidth; x++) {
          for (let y = 0; y < gridHeight; y++) {
            const vorticity = lbmRef.current.getVorticity(x, y);
            const vorticityMag = Math.abs(vorticity);
            
            // Map vorticity to color - NEW COLORS: magenta and lime green
            let r, g, b;
            if (vorticity > 0) {
              // Positive vorticity (clockwise) - MAGENTA
              const intensity = Math.min(1, vorticityMag * 30);
              r = Math.floor(255 * intensity);
              g = Math.floor(50 * intensity);
              b = Math.floor(255 * intensity);
            } else {
              // Negative vorticity (counterclockwise) - LIME GREEN
              const intensity = Math.min(1, vorticityMag * 30);
              r = Math.floor(150 * intensity);
              g = Math.floor(255 * intensity);
              b = Math.floor(50 * intensity);
            }
            
            // Fill pixels for this cell
            for (let px = 0; px < pixelsPerCell; px++) {
              for (let py = 0; py < pixelsPerCell; py++) {
                const pixelX = Math.floor(x * pixelsPerCell + px);
                const pixelY = Math.floor(y * pixelsPerCell + py);
                if (pixelX < width && pixelY < height) {
                  const idx = (pixelY * width + pixelX) * 4;
                  data[idx] = r;
                  data[idx + 1] = g;
                  data[idx + 2] = b;
                  data[idx + 3] = 120; // Increased alpha for visibility
                }
              }
            }
          }
        }
        
        ctx.putImageData(imageData, 0, 0);
      }
      
      // Draw cylinder obstacle
      ctx.fillStyle = '#1e293b';
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(
        cylinderX * pixelsPerCell,
        cylinderY * pixelsPerCell,
        cylinderRadius * pixelsPerCell,
        0,
        Math.PI * 2
      );
      ctx.fill();
      ctx.stroke();
      
      // Update and draw tracer particles
      particlesRef.current.forEach((particle) => {
        // Get velocity from LBM at particle position
        const gridX = Math.floor(particle.x);
        const gridY = Math.floor(particle.y);
        
        if (gridX >= 0 && gridX < gridWidth && gridY >= 0 && gridY < gridHeight) {
          if (!lbmRef.current.obstacle[gridX][gridY]) {
            const ux = lbmRef.current.ux[gridX][gridY];
            const uy = lbmRef.current.uy[gridX][gridY];
            
            // Update position
            particle.x += ux * 10;
            particle.y += uy * 10;
            
            // Wrap around
            if (particle.x > gridWidth) {
              particle.x = 0;
              particle.y = 5 + Math.random() * (gridHeight - 10);
              particle.history = [];
            }
            if (particle.x < 0) particle.x = gridWidth;
            if (particle.y < 0) particle.y = 0;
            if (particle.y > gridHeight) particle.y = gridHeight;
            
            // Update history
            particle.history.push({ x: particle.x, y: particle.y });
            if (particle.history.length > 30) {
              particle.history.shift();
            }
          }
        }
        
        // Draw particle trail
        if (particle.history.length > 1) {
          ctx.strokeStyle = regime.color;
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = 0.6;
          
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
        
        // Draw particle head
        ctx.fillStyle = regime.color;
        ctx.beginPath();
        ctx.arc(
          particle.x * pixelsPerCell,
          particle.y * pixelsPerCell,
          2.5,
          0,
          Math.PI * 2
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
    };
  }, [Re, velocity, diameter, viscosity, density, regime.color]);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
      color: '#e2e8f0',
      fontFamily: "'IBM Plex Mono', monospace",
      padding: '2rem'
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Libre+Baskerville:wght@700&display=swap');
        
        input[type="range"] {
          -webkit-appearance: none;
          width: 100%;
          height: 8px;
          border-radius: 4px;
          background: linear-gradient(to right, #334155 0%, #475569 100%);
          outline: none;
          box-shadow: inset 0 1px 3px rgba(0,0,0,0.3);
        }
        
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%);
          cursor: pointer;
          transition: all 0.2s;
          box-shadow: 0 2px 6px rgba(59, 130, 246, 0.4), 0 0 0 3px rgba(59, 130, 246, 0.1);
        }
        
        input[type="range"]::-webkit-slider-thumb:hover {
          background: linear-gradient(135deg, #93c5fd 0%, #60a5fa 100%);
          transform: scale(1.15);
          box-shadow: 0 3px 8px rgba(59, 130, 246, 0.5), 0 0 0 4px rgba(59, 130, 246, 0.2);
        }
        
        input[type="range"]::-webkit-slider-thumb:active {
          transform: scale(1.05);
        }
        
        input[type="range"]::-moz-range-thumb {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%);
          cursor: pointer;
          border: none;
          transition: all 0.2s;
          box-shadow: 0 2px 6px rgba(59, 130, 246, 0.4), 0 0 0 3px rgba(59, 130, 246, 0.1);
        }
        
        input[type="range"]::-moz-range-thumb:hover {
          background: linear-gradient(135deg, #93c5fd 0%, #60a5fa 100%);
          transform: scale(1.15);
          box-shadow: 0 3px 8px rgba(59, 130, 246, 0.5), 0 0 0 4px rgba(59, 130, 246, 0.2);
        }
        
        input[type="range"]::-moz-range-thumb:active {
          transform: scale(1.05);
        }
        
        .slider-container {
          position: relative;
          padding-top: 12px;
        }
        
        .slider-ticks {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 8px;
          display: flex;
          justify-content: space-between;
          padding: 0 2px;
        }
        
        .slider-tick {
          width: 2px;
          height: 8px;
          background: #475569;
          border-radius: 1px;
        }
        
        .slider-tick.major {
          height: 12px;
          background: #64748b;
          width: 3px;
        }
      `}</style>

      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header */}
        <header style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <h1 style={{ 
            fontSize: '3rem', 
            fontWeight: '700', 
            marginBottom: '1rem',
            background: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            fontFamily: "'Libre Baskerville', serif"
          }}>
            Reynolds Number Intuitron
          </h1>
          <p style={{ fontSize: '1.1rem', color: '#94a3b8' }}>
            Watch real fluid dynamics emerge from simple physics
          </p>
        </header>

        {/* Hero: Flow Visualization */}
        <div style={{ 
          background: '#1e293b', 
          padding: '2rem', 
          borderRadius: '12px', 
          marginBottom: '2rem',
          border: '1px solid #334155'
        }}>
          <h2 style={{ fontSize: '1.2rem', marginBottom: '1rem', color: '#60a5fa', textAlign: 'center' }}>
            Flow Around Cylinder — Lattice Boltzmann Simulation
          </h2>
          <canvas
            ref={canvasRef}
            width={1000}
            height={400}
            style={{
              width: '100%',
              height: 'auto',
              borderRadius: '8px',
              background: '#0a0f1a',
              border: '2px solid #334155'
            }}
          />
          <div style={{ 
            marginTop: '1rem', 
            textAlign: 'center', 
            fontSize: '0.85rem', 
            color: '#64748b',
            fontStyle: 'italic'
          }}>
            {Re < 40 && 'Viscosity dominates - flow wraps smoothly around cylinder'}
            {Re >= 40 && Re < 200 && 'Watch the wake beginning to destabilize behind the cylinder'}
            {Re >= 200 && 'Vortices shedding - the famous von Kármán vortex street!'}
            <br/>
            <span style={{ color: '#60a5fa', fontSize: '0.75rem' }}>
              Color shows vorticity: <span style={{ color: '#ff50ff' }}>magenta = clockwise</span>, <span style={{ color: '#96ff32' }}>lime = counterclockwise</span>
            </span>
          </div>
        </div>

        {/* Controls and Results */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
          {/* Input Controls */}
          <div style={{ background: '#1e293b', padding: '2rem', borderRadius: '12px', border: '1px solid #334155' }}>
            <h2 style={{ fontSize: '1.2rem', marginBottom: '1.5rem', color: '#60a5fa' }}>Flow Parameters</h2>
            
            <div style={{ marginBottom: '2rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: '#94a3b8' }}>
                Fluid Viscosity, <span style={{ fontStyle: 'italic' }}>μ</span>: <span style={{ color: '#60a5fa', fontWeight: '600' }}>{viscosity.toExponential(2)} Pa·s</span>
              </label>
              <div className="slider-container">
                <div className="slider-ticks">
                  {[0, 1, 2, 3, 4, 5, 6].map(i => (
                    <div key={i} className={`slider-tick ${i % 2 === 0 ? 'major' : ''}`} />
                  ))}
                </div>
                <input
                  type="range"
                  min="-5"
                  max="1"
                  step="0.05"
                  value={viscosityLog}
                  onChange={(e) => setViscosityLog(parseFloat(e.target.value))}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                <span>10⁻⁵ (Air)</span>
                <span>10¹ (Honey)</span>
              </div>
              {isNearFluid && (
                <div style={{ 
                  marginTop: '0.5rem', 
                  padding: '0.5rem', 
                  background: '#0f172a', 
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                  color: '#60a5fa'
                }}>
                  ≈ {closestFluid.name}
                </div>
              )}
            </div>

            <div style={{ marginBottom: '2rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: '#94a3b8' }}>
                Density, <span style={{ fontStyle: 'italic' }}>ρ</span>: <span style={{ color: '#60a5fa', fontWeight: '600' }}>{density.toFixed(0)} kg/m³</span>
              </label>
              <div className="slider-container">
                <div className="slider-ticks">
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => (
                    <div key={i} className={`slider-tick ${i % 5 === 0 ? 'major' : ''}`} />
                  ))}
                </div>
                <input
                  type="range"
                  min="1"
                  max="1500"
                  step="1"
                  value={density}
                  onChange={(e) => setDensity(parseFloat(e.target.value))}
                  disabled={isNearFluid}
                  style={{ opacity: isNearFluid ? 0.5 : 1 }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                <span>1 kg/m³</span>
                <span>1500 kg/m³</span>
              </div>
              {!isNearFluid && (
                <div style={{ 
                  marginTop: '0.5rem', 
                  padding: '0.5rem', 
                  background: '#0f172a', 
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  color: '#94a3b8',
                  fontStyle: 'italic'
                }}>
                  💡 Custom fluid - adjust density manually
                </div>
              )}
            </div>

            <div style={{ marginBottom: '2rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: '#94a3b8' }}>
                Velocity, <span style={{ fontStyle: 'italic' }}>V</span>: <span style={{ color: '#60a5fa', fontWeight: '600' }}>{velocity.toFixed(2)} m/s</span>
              </label>
              <div className="slider-container">
                <div className="slider-ticks">
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => (
                    <div key={i} className={`slider-tick ${i % 5 === 0 ? 'major' : ''}`} />
                  ))}
                </div>
                <input
                  type="range"
                  min="0.01"
                  max="10"
                  step="0.01"
                  value={velocity}
                  onChange={(e) => setVelocity(parseFloat(e.target.value))}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                <span>0.01 m/s</span>
                <span>10 m/s</span>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: '#94a3b8' }}>
                Cylinder Diameter, <span style={{ fontStyle: 'italic' }}>D</span>: <span style={{ color: '#60a5fa', fontWeight: '600' }}>{(diameter * 1000).toFixed(0)} mm</span>
              </label>
              <div className="slider-container">
                <div className="slider-ticks">
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => (
                    <div key={i} className={`slider-tick ${i % 5 === 0 ? 'major' : ''}`} />
                  ))}
                </div>
                <input
                  type="range"
                  min="0.001"
                  max="0.5"
                  step="0.001"
                  value={diameter}
                  onChange={(e) => setDiameter(parseFloat(e.target.value))}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                <span>1 mm</span>
                <span>500 mm</span>
              </div>
            </div>
          </div>

          {/* Results */}
          <div style={{ background: '#1e293b', padding: '2rem', borderRadius: '12px', border: '1px solid #334155' }}>
            <h2 style={{ fontSize: '1.2rem', marginBottom: '1.5rem', color: '#60a5fa' }}>Calculated Values</h2>
            
            {/* Reynolds Equation */}
            <div style={{ 
              marginBottom: '2rem', 
              padding: '1rem', 
              background: '#0f172a', 
              borderRadius: '8px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.5rem' }}>Reynolds Number Equation</div>
              <div style={{ 
                fontSize: '1.5rem', 
                color: '#e2e8f0',
                fontFamily: "'IBM Plex Mono', monospace"
              }}>
                Re = <span style={{ 
                  borderTop: '1px solid #64748b', 
                  display: 'inline-block', 
                  paddingTop: '0.25rem',
                  marginLeft: '0.5rem',
                  marginRight: '0.5rem'
                }}>
                  <span style={{ fontStyle: 'italic' }}>ρVD</span>
                </span> / <span style={{ fontStyle: 'italic', marginLeft: '0.25rem' }}>μ</span>
              </div>
            </div>
            
            <div style={{ marginBottom: '2rem' }}>
              <div style={{ fontSize: '0.9rem', color: '#94a3b8', marginBottom: '0.5rem' }}>Reynolds Number</div>
              <div style={{ 
                fontSize: '3rem', 
                fontWeight: '600', 
                color: regime.color,
                fontFamily: "'IBM Plex Mono', monospace",
                lineHeight: '1'
              }}>
                {Re.toFixed(0)}
              </div>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.9rem', color: '#94a3b8', marginBottom: '0.5rem' }}>Darcy Friction Factor</div>
              <div style={{ fontSize: '1.5rem', fontWeight: '600', color: '#60a5fa' }}>
                f = {frictionFactor.toFixed(4)}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.9rem', color: '#94a3b8', marginBottom: '0.5rem' }}>Pressure Drop (per meter)</div>
              <div style={{ fontSize: '1.5rem', fontWeight: '600', color: '#60a5fa' }}>
                {pressureDrop.toFixed(1)} Pa/m
              </div>
            </div>
          </div>
        </div>

        {/* Flow Regime Indicator */}
        <div style={{ 
          background: '#1e293b', 
          padding: '2rem', 
          borderRadius: '12px', 
          border: '1px solid #334155',
          marginBottom: '2rem'
        }}>
          <h2 style={{ fontSize: '1.2rem', marginBottom: '1.5rem', color: '#60a5fa', textAlign: 'center' }}>
            Flow Regime: <span style={{ color: regime.color }}>{regime.name}</span>
          </h2>
          
          {/* Indicator Bar */}
          <div style={{ position: 'relative', marginBottom: '1rem' }}>
            <div style={{ 
              height: '60px', 
              borderRadius: '8px', 
              overflow: 'hidden',
              display: 'flex',
              border: '2px solid #334155'
            }}>
              <div style={{ flex: '1', background: 'linear-gradient(to right, #1e3a8a, #3b82f6)', position: 'relative' }}>
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: '0.9rem', fontWeight: '600', color: 'white' }}>
                  Laminar
                </div>
                <div style={{ position: 'absolute', bottom: '2px', left: '50%', transform: 'translateX(-50%)', fontSize: '0.7rem', color: '#93c5fd' }}>
                  Re &lt; 2,300
                </div>
              </div>
              <div style={{ flex: '1', background: 'linear-gradient(to right, #f59e0b, #fb923c)', position: 'relative' }}>
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: '0.9rem', fontWeight: '600', color: 'white' }}>
                  Transitional
                </div>
                <div style={{ position: 'absolute', bottom: '2px', left: '50%', transform: 'translateX(-50%)', fontSize: '0.7rem', color: '#fed7aa' }}>
                  2,300 - 4,000
                </div>
              </div>
              <div style={{ flex: '1', background: 'linear-gradient(to right, #ef4444, #dc2626)', position: 'relative' }}>
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: '0.9rem', fontWeight: '600', color: 'white' }}>
                  Turbulent
                </div>
                <div style={{ position: 'absolute', bottom: '2px', left: '50%', transform: 'translateX(-50%)', fontSize: '0.7rem', color: '#fca5a5' }}>
                  Re &gt; 4,000
                </div>
              </div>
            </div>
            
            {/* Sliding Pointer */}
            <div style={{
              position: 'absolute',
              top: '-10px',
              left: `${regime.position}%`,
              transform: 'translateX(-50%)',
              transition: 'left 0.3s ease'
            }}>
              <div style={{
                width: '0',
                height: '0',
                borderLeft: '12px solid transparent',
                borderRight: '12px solid transparent',
                borderTop: `16px solid ${regime.color}`,
                filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))'
              }} />
            </div>
            
            <div style={{
              position: 'absolute',
              bottom: '-10px',
              left: `${regime.position}%`,
              transform: 'translateX(-50%)',
              transition: 'left 0.3s ease'
            }}>
              <div style={{
                width: '0',
                height: '0',
                borderLeft: '12px solid transparent',
                borderRight: '12px solid transparent',
                borderBottom: `16px solid ${regime.color}`,
                filter: 'drop-shadow(0 -2px 4px rgba(0,0,0,0.3))'
              }} />
            </div>
          </div>

          {/* Regime Description */}
          <div style={{ marginTop: '2rem', padding: '1.5rem', background: '#0f172a', borderRadius: '8px' }}>
            <div style={{ fontSize: '0.95rem', color: '#cbd5e1', marginBottom: '1rem' }}>
              {description.notes}
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', fontSize: '0.85rem' }}>
              <div>
                <div style={{ color: '#60a5fa', fontWeight: '600', marginBottom: '0.5rem' }}>Characteristics:</div>
                {description.characteristics.map((char, i) => (
                  <div key={i} style={{ color: '#94a3b8', marginBottom: '0.25rem' }}>• {char}</div>
                ))}
              </div>
              <div>
                <div style={{ color: '#60a5fa', fontWeight: '600', marginBottom: '0.5rem' }}>Applications:</div>
                {description.applications.map((app, i) => (
                  <div key={i} style={{ color: '#94a3b8', marginBottom: '0.25rem' }}>• {app}</div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <footer style={{ marginTop: '3rem', textAlign: 'center', fontSize: '0.85rem', color: '#64748b' }}>
          <div>Intuitron — Interactive Engineering Education</div>
          <div style={{ marginTop: '0.5rem' }}>Real fluid dynamics powered by Lattice Boltzmann Method</div>
        </footer>
      </div>
    </div>
  );
};

export default ReynoldsIntuitron;
