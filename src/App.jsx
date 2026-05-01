import React, { useState, useEffect, useRef } from 'react';

const FLUIDS = {
  water: { name: 'Water (20°C)', density: 998, viscosity: 0.001002 },
  air: { name: 'Air (20°C)', density: 1.204, viscosity: 0.00001825 },
  oil: { name: 'Oil (SAE 30)', density: 870, viscosity: 0.29 },
  glycerin: { name: 'Glycerin (20°C)', density: 1260, viscosity: 1.412 },
  honey: { name: 'Honey', density: 1420, viscosity: 10.0 }
};

const ReynoldsIntuitron = () => {
  // Log scale for viscosity: 10^-5 to 10^1
  const [viscosityLog, setViscosityLog] = useState(Math.log10(0.001002)); // Start with water
  const [density, setDensity] = useState(998); // Water density
  const [velocity, setVelocity] = useState(1.0);
  const [diameter, setDiameter] = useState(0.05);
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
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
        characteristics: ['Smooth, orderly flow', 'Parabolic velocity profile', 'Predictable behavior'],
        applications: ['Blood flow in capillaries', 'Honey pouring', 'Lubrication systems'],
        notes: 'Flow in parallel layers with minimal mixing between them'
      };
    } else if (Re < 4000) {
      return {
        characteristics: ['Unstable flow patterns', 'Intermittent turbulence', 'Variable behavior'],
        applications: ['Transition zones in piping', 'Variable flow systems'],
        notes: 'Flow oscillates between laminar and turbulent states'
      };
    } else {
      return {
        characteristics: ['Chaotic, swirling motion', 'Flat velocity profile', 'Excellent mixing'],
        applications: ['Water distribution', 'HVAC systems', 'Most industrial flows'],
        notes: 'Random fluctuations with high energy dissipation'
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

    // Initialize particles
    if (particlesRef.current.length === 0) {
      for (let i = 0; i < 150; i++) {
        particlesRef.current.push({
          x: Math.random() * width,
          y: Math.random() * height,
          baseY: Math.random() * height,
          speed: 0,
          turbulence: { x: 0, y: 0 }
        });
      }
    }

    const animate = () => {
      ctx.fillStyle = '#0a0f1a';
      ctx.fillRect(0, 0, width, height);

      // Draw pipe walls
      ctx.strokeStyle = '#1e293b44';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 40);
      ctx.lineTo(width, 40);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, height - 40);
      ctx.lineTo(width, height - 40);
      ctx.stroke();

      // Update and draw particles
      particlesRef.current.forEach((particle) => {
        // Calculate position in pipe (0 = wall, 1 = center)
        const relativeY = Math.abs((particle.y - height / 2) / (height / 2 - 40));
        
        if (Re < 2300) {
          // Laminar: parabolic velocity profile
          particle.speed = velocity * 100 * (1 - relativeY * relativeY) * 0.3;
          particle.turbulence = { x: 0, y: 0 };
        } else if (Re < 4000) {
          // Transitional: some randomness
          particle.speed = velocity * 100 * (1 - relativeY * 0.5) * 0.3;
          particle.turbulence = {
            x: (Math.random() - 0.5) * 0.5,
            y: (Math.random() - 0.5) * 0.5
          };
        } else {
          // Turbulent: flat profile with high randomness
          particle.speed = velocity * 100 * 0.9 * 0.3;
          particle.turbulence = {
            x: (Math.random() - 0.5) * 2,
            y: (Math.random() - 0.5) * 2
          };
        }

        particle.x += particle.speed + particle.turbulence.x;
        particle.y += particle.turbulence.y;

        // Boundary conditions
        if (particle.y < 42) particle.y = 42;
        if (particle.y > height - 42) particle.y = height - 42;

        // Wrap around
        if (particle.x > width) {
          particle.x = 0;
          particle.y = 40 + Math.random() * (height - 80);
          particle.baseY = particle.y;
        }

        // Draw particle
        const alpha = 1 - relativeY * 0.3;
        ctx.fillStyle = `${regime.color}${Math.floor(alpha * 255).toString(16).padStart(2, '0')}`;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, 2, 0, Math.PI * 2);
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
  }, [Re, velocity, regime.color]);

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
          background: #1e293b;
          outline: none;
        }
        
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          border: 2px solid #0f172a;
          box-shadow: 0 0 10px rgba(59, 130, 246, 0.5);
        }
        
        input[type="range"]::-moz-range-thumb {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          border: 2px solid #0f172a;
          box-shadow: 0 0 10px rgba(59, 130, 246, 0.5);
        }
      `}</style>

      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <header style={{ marginBottom: '2rem', textAlign: 'center' }}>
          <h1 style={{
            fontFamily: "'Libre Baskerville', serif",
            fontSize: '2.5rem',
            fontWeight: '700',
            marginBottom: '0.5rem',
            background: 'linear-gradient(135deg, #60a5fa, #3b82f6)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            letterSpacing: '-0.02em'
          }}>
            Reynolds Number Calculator
          </h1>
          <p style={{ fontSize: '1.1rem', color: '#94a3b8', fontWeight: '400' }}>
            Re = ρVD/μ — Understanding Flow Regimes
          </p>
        </header>

        {/* Flow Visualization - HERO */}
        <div style={{ 
          background: '#1e293b', 
          padding: '2rem', 
          borderRadius: '12px', 
          border: '1px solid #334155',
          marginBottom: '2rem'
        }}>
          <h2 style={{ fontSize: '1.2rem', marginBottom: '1.5rem', color: '#60a5fa', textAlign: 'center' }}>
            Flow Visualization
          </h2>
          <canvas
            ref={canvasRef}
            width={1200}
            height={300}
            style={{ 
              width: '100%', 
              height: 'auto', 
              borderRadius: '8px',
              border: '2px solid #334155'
            }}
          />
          <div style={{ marginTop: '1rem', textAlign: 'center', fontSize: '0.85rem', color: '#64748b' }}>
            Particle motion showing flow behavior — {regime.name.toLowerCase()} flow regime
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
          {/* Controls */}
          <div style={{ background: '#1e293b', padding: '2rem', borderRadius: '12px', border: '1px solid #334155' }}>
            <h2 style={{ fontSize: '1.2rem', marginBottom: '1.5rem', color: '#60a5fa' }}>Flow Parameters</h2>
            
            <div style={{ marginBottom: '2rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: '#94a3b8' }}>
                Dynamic Viscosity: <span style={{ color: '#60a5fa', fontWeight: '600' }}>{viscosity.toExponential(3)} Pa·s</span>
              </label>
              {isNearFluid && (
                <div style={{ 
                  fontSize: '1rem', 
                  fontWeight: '600', 
                  color: '#22d3ee', 
                  marginBottom: '0.5rem'
                }}>
                  ≈ {closestFluid.name}
                </div>
              )}
              <input
                type="range"
                min="-5"
                max="1"
                step="0.01"
                value={viscosityLog}
                onChange={(e) => setViscosityLog(parseFloat(e.target.value))}
                style={{ marginBottom: '0.5rem' }}
              />
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                fontSize: '0.7rem', 
                color: '#64748b',
                marginTop: '0.25rem',
                position: 'relative',
                paddingTop: '0.5rem'
              }}>
                {Object.entries(FLUIDS).map(([key, fluid]) => {
                  const logVisc = Math.log10(fluid.viscosity);
                  const position = ((logVisc + 5) / 6) * 100; // Map -5 to 1 range to 0-100%
                  return (
                    <div
                      key={key}
                      style={{
                        position: 'absolute',
                        left: `${position}%`,
                        transform: 'translateX(-50%)',
                        textAlign: 'center',
                        color: isNearFluid && closestFluid.key === key ? '#22d3ee' : '#64748b',
                        fontWeight: isNearFluid && closestFluid.key === key ? '600' : '400'
                      }}
                    >
                      <div style={{
                        width: '2px',
                        height: '8px',
                        background: isNearFluid && closestFluid.key === key ? '#22d3ee' : '#334155',
                        margin: '0 auto 0.25rem'
                      }} />
                      {fluid.name.split(' ')[0]}
                    </div>
                  );
                })}
              </div>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                fontSize: '0.7rem', 
                color: '#475569',
                marginTop: '2rem'
              }}>
                <span>10⁻⁵ Pa·s</span>
                <span>10¹ Pa·s</span>
              </div>
            </div>
            
            <div style={{ marginBottom: '2rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: '#94a3b8' }}>
                Density: <span style={{ color: '#60a5fa', fontWeight: '600' }}>{density} kg/m³</span>
              </label>
              <input
                type="range"
                min="1"
                max="1500"
                step="1"
                value={density}
                onChange={(e) => setDensity(parseFloat(e.target.value))}
              />
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
                Velocity: <span style={{ color: '#60a5fa', fontWeight: '600' }}>{velocity.toFixed(2)} m/s</span>
              </label>
              <input
                type="range"
                min="0.01"
                max="10"
                step="0.01"
                value={velocity}
                onChange={(e) => setVelocity(parseFloat(e.target.value))}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                <span>0.01 m/s</span>
                <span>10 m/s</span>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: '#94a3b8' }}>
                Pipe Diameter: <span style={{ color: '#60a5fa', fontWeight: '600' }}>{(diameter * 1000).toFixed(0)} mm</span>
              </label>
              <input
                type="range"
                min="0.001"
                max="0.5"
                step="0.001"
                value={diameter}
                onChange={(e) => setDiameter(parseFloat(e.target.value))}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                <span>1 mm</span>
                <span>500 mm</span>
              </div>
            </div>
          </div>

          {/* Results */}
          <div style={{ background: '#1e293b', padding: '2rem', borderRadius: '12px', border: '1px solid #334155' }}>
            <h2 style={{ fontSize: '1.2rem', marginBottom: '1.5rem', color: '#60a5fa' }}>Calculated Values</h2>
            
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
          <div style={{ marginTop: '0.5rem' }}>Built for developing engineering intuition through exploration</div>
        </footer>
      </div>
    </div>
  );
};

export default ReynoldsIntuitron;