/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Settings2, 
  Play, 
  Pause, 
  RotateCcw, 
  Info,
  Maximize2,
  Minimize2,
  ChevronRight,
  ChevronLeft
} from 'lucide-react';

// --- Types & Constants ---

interface SimulationState {
  alpha: number; // Angle of incline in degrees
  M: number;     // Mass of inclined plane
  m: number;     // Combined mass of wedge, glass, and water
  g: number;     // Gravity
  mu: number;    // Friction coefficient between wedge and plane
  isFixed: boolean;
  isSimulating: boolean;
  time: number;
  
  // Dynamic state
  X: number;     // Horizontal position of large plane M
  s: number;     // Displacement of wedge m along the incline
  vX: number;    // Velocity of M
  vs: number;    // Velocity of m along incline
  
  isDragging: boolean;
  dragStartX: number;
  targetX: number;
  
  // Water surface state (for sloshing)
  surfaceAngle: number; // Current angle of water surface from horizontal
  surfaceAngularVel: number; // Angular velocity of surface
}

const INITIAL_STATE: SimulationState = {
  alpha: 30,
  M: 10,
  m: 2,
  g: 9.81,
  mu: 0.1,
  isFixed: true,
  isSimulating: false,
  time: 0,
  X: 0,
  s: 0,
  vX: 0,
  vs: 0,
  isDragging: false,
  dragStartX: 0,
  targetX: 0,
  surfaceAngle: 0,
  surfaceAngularVel: 0,
};

// --- Components ---

export default function App() {
  const [state, setState] = useState<SimulationState>(INITIAL_STATE);
  const [showControls, setShowControls] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(null);
  const lastTimeRef = useRef<number>(0);

  // Physics calculation
  const updatePhysics = useCallback((dt: number) => {
    setState(prev => {
      const alphaRad = (prev.alpha * Math.PI) / 180;
      const sinA = Math.sin(alphaRad);
      const cosA = Math.cos(alphaRad);
      
      let accS = 0;
      let accX = 0;

      // Only calculate wedge acceleration if simulating
      if (prev.isSimulating) {
        if (prev.isFixed) {
          accS = Math.max(0, prev.g * (sinA - prev.mu * cosA));
          accX = 0;
        } else {
          if (sinA > prev.mu * cosA) {
            const numeratorX = -prev.m * prev.g * cosA * (sinA - prev.mu * cosA);
            const denominatorX = prev.M + prev.m * sinA * sinA - prev.mu * prev.m * sinA * cosA;
            accX = numeratorX / denominatorX;
            accS = prev.g * (sinA - prev.mu * cosA) + accX * (cosA + prev.mu * sinA);
          } else {
            accX = 0;
            accS = 0;
          }
        }
      }

      // Handle dragging acceleration
      let effectiveAccX = accX;
      let nextVX = prev.vX;
      let nextX = prev.X;

      if (prev.isDragging) {
        const dragStiffness = 300;
        const dragDamping = 15;
        const dragForce = dragStiffness * (prev.targetX - prev.X) - dragDamping * prev.vX;
        effectiveAccX = dragForce;
        nextVX = prev.vX + effectiveAccX * dt;
        nextX = prev.X + nextVX * dt;
      } else if (prev.isSimulating) {
        nextVX = prev.vX + accX * dt;
        nextX = prev.X + prev.vX * dt + 0.5 * accX * dt * dt;
      } else {
        const stopDamping = 10;
        effectiveAccX = -prev.vX * stopDamping;
        nextVX = prev.vX + effectiveAccX * dt;
        if (Math.abs(nextVX) < 0.1) nextVX = 0;
        nextX = prev.X + nextVX * dt;
      }

      // Update wedge positions
      const nextVs = prev.isSimulating ? prev.vs + accS * dt : 0;
      const nextS = prev.isSimulating ? prev.s + prev.vs * dt + 0.5 * accS * dt * dt : prev.s;
      
      // Calculate target surface angle
      const ax = effectiveAccX + accS * cosA;
      const ay = accS * sinA;
      const targetAngle = Math.atan2(ax, prev.g - ay);

      // Sloshing physics (Damped Harmonic Oscillator for the angle)
      // This runs ALWAYS, even when paused
      const stiffness = 40; 
      const damping = 6;    
      
      const angleDiff = targetAngle - prev.surfaceAngle;
      const angularAcc = stiffness * angleDiff - damping * prev.surfaceAngularVel;
      
      const nextAngularVel = prev.surfaceAngularVel + angularAcc * dt;
      const nextSurfaceAngle = prev.surfaceAngle + prev.surfaceAngularVel * dt;

      // Boundary check - stop if it hits the ground or goes off top
      let isSimulating = prev.isSimulating;
      const blockWidth = 100;
      const planeLength = 600;
      const startOffset = 100;
      
      // If wedge hits the ground (bottom of incline)
      if (nextS + startOffset + blockWidth >= planeLength) {
        return {
          ...prev,
          isSimulating: false,
          s: planeLength - startOffset - blockWidth,
          vs: 0,
          X: nextX,
          vX: nextVX,
          surfaceAngle: nextSurfaceAngle,
          surfaceAngularVel: nextAngularVel,
          time: prev.time
        };
      }

      // If wedge goes off the top
      if (nextS + startOffset < 0) {
        return {
          ...prev,
          isSimulating: false,
          s: -startOffset,
          vs: 0,
          X: nextX,
          vX: nextVX,
          surfaceAngle: nextSurfaceAngle,
          surfaceAngularVel: nextAngularVel,
          time: prev.time
        };
      }

      return {
        ...prev,
        isSimulating,
        s: nextS,
        vs: nextVs,
        X: nextX,
        vX: nextVX,
        surfaceAngle: nextSurfaceAngle,
        surfaceAngularVel: nextAngularVel,
        time: prev.isSimulating ? prev.time + dt : prev.time
      };
    });
  }, []);

  const animate = useCallback((time: number) => {
    if (lastTimeRef.current !== undefined) {
      const dt = (time - lastTimeRef.current) / 1000;
      // Cap dt to avoid huge jumps
      updatePhysics(Math.min(dt, 0.1));
    }
    lastTimeRef.current = time;
    requestRef.current = requestAnimationFrame(animate);
  }, [updatePhysics]);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(animate);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [animate]);

  // Rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle DPI
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const { width, height } = rect;
    ctx.clearRect(0, 0, width, height);

    // Draw background grid
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    for (let i = 0; i < width; i += 50) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, height); ctx.stroke();
    }
    for (let i = 0; i < height; i += 50) {
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(width, i); ctx.stroke();
    }

    // Origin for the inclined plane
    const alphaRad = (state.alpha * Math.PI) / 180;
    const planeBaseX = 200 + state.X;
    const planeBaseY = height - 100;
    const planeLength = 600;
    
    const topX = planeBaseX;
    const topY = planeBaseY - planeLength * Math.sin(alphaRad);
    const bottomX = planeBaseX + planeLength * Math.cos(alphaRad);
    const bottomY = planeBaseY;

    // 1. Draw Large Inclined Plane (M)
    ctx.fillStyle = state.isDragging ? '#e5e7eb' : '#f3f4f6';
    ctx.strokeStyle = state.isDragging ? '#3b82f6' : '#1f2937';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.lineTo(bottomX, bottomY);
    ctx.lineTo(topX, bottomY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Label M
    ctx.fillStyle = '#1f2937';
    ctx.font = 'italic 24px serif';
    ctx.fillText('M', topX + 40, bottomY - 30);

    // Draw angle alpha
    ctx.beginPath();
    ctx.arc(bottomX, bottomY, 60, Math.PI, Math.PI + alphaRad);
    ctx.stroke();
    ctx.font = '16px serif';
    ctx.fillText('α', bottomX - 80, bottomY - 15);

    // 2. Draw Wedge (m) - Support block sitting ON TOP of the incline
    // Position along incline
    const wedgeS = state.s + 100; // Offset from top
    const wedgeX = topX + wedgeS * Math.cos(alphaRad);
    const wedgeY = topY + wedgeS * Math.sin(alphaRad);

    const blockWidth = 100;
    const blockHeight = 40; // Height of the vertical sides

    // Vertices of the support block (trapezoid sitting on incline)
    // p1: bottom-left (on incline)
    // p2: bottom-right (on incline)
    // p3: top-right (above p2)
    // p4: top-left (above p1)
    
    const p1 = { x: wedgeX, y: wedgeY };
    const p2 = { x: wedgeX + blockWidth * Math.cos(alphaRad), y: wedgeY + blockWidth * Math.sin(alphaRad) };
    
    // To make the top horizontal, p3.y and p4.y must be the same.
    // We'll set the top level based on the highest point of the base (p1) minus some height.
    const topLevelY = p1.y - blockHeight;
    
    const p3 = { x: p2.x, y: topLevelY };
    const p4 = { x: p1.x, y: topLevelY };

    ctx.fillStyle = '#d1d5db';
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.lineTo(p4.x, p4.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Label m
    ctx.fillStyle = '#1f2937';
    ctx.font = 'italic 18px serif';
    ctx.fillText('m', p2.x + 10, p3.y + 10);

    // 3. Draw Glass (Vertical) on the horizontal top
    const glassWidth = 40;
    const glassHeight = 60;
    const glassX = p4.x + (p3.x - p4.x) / 2 - glassWidth / 2;
    const glassY = topLevelY;

    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 2;
    ctx.strokeRect(glassX, glassY - glassHeight, glassWidth, glassHeight);

    // 4. Draw Water
    // Surface is dynamic based on acceleration (sloshing)
    const waterLevel = 0.5;
    const waterCenterY = glassY - glassHeight * waterLevel;
    
    // The surface line passes through (glassX + glassWidth/2, waterCenterY)
    // and has slope tan(state.surfaceAngle)
    const halfW = glassWidth / 2;
    const dy = halfW * Math.tan(state.surfaceAngle);
    
    const surfLeftY = waterCenterY - dy;
    const surfRightY = waterCenterY + dy;

    ctx.fillStyle = 'rgba(59, 130, 246, 0.5)';
    ctx.beginPath();
    ctx.moveTo(glassX, glassY);
    ctx.lineTo(glassX + glassWidth, glassY);
    ctx.lineTo(glassX + glassWidth, surfRightY);
    ctx.lineTo(glassX, surfLeftY);
    ctx.closePath();
    ctx.fill();
    
    // Surface line
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(glassX, surfLeftY);
    ctx.lineTo(glassX + glassWidth, surfRightY);
    ctx.stroke();

    ctx.restore();

    // Floor line
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, bottomY);
    ctx.lineTo(width, bottomY);
    ctx.stroke();

    // Draw motion arrows if moving
    if (state.isSimulating) {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      // Arrow for M
      if (!state.isFixed) {
        const arrowX = topX - 40;
        const arrowY = bottomY - 50;
        ctx.beginPath();
        ctx.moveTo(arrowX, arrowY);
        ctx.lineTo(arrowX - 30, arrowY);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(arrowX - 30, arrowY);
        ctx.lineTo(arrowX - 20, arrowY - 5);
        ctx.moveTo(arrowX - 30, arrowY);
        ctx.lineTo(arrowX - 20, arrowY + 5);
        ctx.stroke();
      }
    }

  }, [state]);

  const handleReset = () => {
    setState(prev => ({
      ...INITIAL_STATE,
      alpha: prev.alpha,
      M: prev.M,
      m: prev.m,
      g: prev.g,
      mu: prev.mu,
      isFixed: prev.isFixed
    }));
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const alphaRad = (state.alpha * Math.PI) / 180;
    const planeBaseX = 200 + state.X;
    const planeBaseY = rect.height - 100;
    const planeLength = 600;
    
    const topX = planeBaseX;
    const topY = planeBaseY - planeLength * Math.sin(alphaRad);
    const bottomX = planeBaseX + planeLength * Math.cos(alphaRad);
    const bottomY = planeBaseY;

    // Check if click is inside the triangle (M)
    // Vertices: (topX, topY), (bottomX, bottomY), (topX, bottomY)
    const isInside = (px: number, py: number) => {
      const slope = Math.tan(alphaRad);
      const hypotenuseY = topY + (px - topX) * slope;
      return px >= topX && px <= bottomX && py >= hypotenuseY && py <= bottomY;
    };

    if (isInside(x, y)) {
      setState(s => ({ ...s, isDragging: true, dragStartX: x - s.X, targetX: s.X }));
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (state.isDragging) {
      setState(s => ({ 
        ...s, 
        targetX: x - s.dragStartX
      }));
    } else {
      // Update cursor if hovering over the plane
      const alphaRad = (state.alpha * Math.PI) / 180;
      const planeBaseX = 200 + state.X;
      const planeBaseY = rect.height - 100;
      const planeLength = 600;
      const topX = planeBaseX;
      const topY = planeBaseY - planeLength * Math.sin(alphaRad);
      const bottomX = planeBaseX + planeLength * Math.cos(alphaRad);
      const bottomY = planeBaseY;
      
      const slope = Math.tan(alphaRad);
      const hypotenuseY = topY + (x - topX) * slope;
      const isOver = x >= topX && x <= bottomX && y >= hypotenuseY && y <= bottomY;
      canvas.style.cursor = isOver ? 'grab' : 'crosshair';
    }
  };

  const handleMouseUp = () => {
    if (state.isDragging) {
      setState(s => ({ ...s, isDragging: false }));
    }
  };

  return (
    <div 
      className="flex h-screen w-full bg-[#f9fafb] text-slate-900 font-sans overflow-hidden"
      onMouseUp={handleMouseUp}
      onMouseMove={handleMouseMove}
    >
      {/* Sidebar Controls */}
      <AnimatePresence mode="wait">
        {showControls && (
          <motion.aside
            initial={{ x: -320 }}
            animate={{ x: 0 }}
            exit={{ x: -320 }}
            className="w-80 h-full bg-white border-r border-slate-200 shadow-xl z-20 flex flex-col"
          >
            <div className="p-6 border-bottom border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings2 className="w-5 h-5 text-blue-600" />
                <h2 className="font-semibold text-lg tracking-tight">Parameters</h2>
              </div>
              <button 
                onClick={() => setShowControls(false)}
                className="p-1 hover:bg-slate-100 rounded-md transition-colors"
              >
                <ChevronLeft className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              {/* Angle Alpha */}
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-slate-700">Incline Angle (α)</label>
                  <span className="text-xs font-mono bg-slate-100 px-2 py-1 rounded">{state.alpha}°</span>
                </div>
                <input 
                  type="range" min="5" max="60" step="1"
                  value={state.alpha}
                  onChange={(e) => setState(s => ({ ...s, alpha: Number(e.target.value) }))}
                  className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>

              {/* Mass M */}
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-slate-700">Mass of Plane (M)</label>
                  <span className="text-xs font-mono bg-slate-100 px-2 py-1 rounded">{state.M} kg</span>
                </div>
                <input 
                  type="range" min="1" max="50" step="0.5"
                  value={state.M}
                  onChange={(e) => setState(s => ({ ...s, M: Number(e.target.value) }))}
                  className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>

              {/* Mass m */}
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-slate-700">Mass of Wedge (m)</label>
                  <span className="text-xs font-mono bg-slate-100 px-2 py-1 rounded">{state.m} kg</span>
                </div>
                <input 
                  type="range" min="0.1" max="10" step="0.1"
                  value={state.m}
                  onChange={(e) => setState(s => ({ ...s, m: Number(e.target.value) }))}
                  className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>

              {/* Gravity g */}
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-slate-700">Gravity (g)</label>
                  <span className="text-xs font-mono bg-slate-100 px-2 py-1 rounded">{state.g} m/s²</span>
                </div>
                <input 
                  type="range" min="1" max="20" step="0.1"
                  value={state.g}
                  onChange={(e) => setState(s => ({ ...s, g: Number(e.target.value) }))}
                  className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>

              {/* Friction mu */}
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-slate-700">Friction (μ)</label>
                  <span className="text-xs font-mono bg-slate-100 px-2 py-1 rounded">{state.mu.toFixed(2)}</span>
                </div>
                <input 
                  type="range" min="0" max="1" step="0.01"
                  value={state.mu}
                  onChange={(e) => setState(s => ({ ...s, mu: Number(e.target.value) }))}
                  className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>

              {/* Fixed Plane Toggle */}
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-slate-800">Fixed Plane</span>
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">Case (i) vs (ii)</span>
                </div>
                <button
                  onClick={() => setState(s => ({ ...s, isFixed: !s.isFixed }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${state.isFixed ? 'bg-blue-600' : 'bg-slate-300'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${state.isFixed ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>

            <div className="p-6 border-t border-slate-100 space-y-3">
              <button
                onClick={() => setState(s => ({ ...s, isSimulating: !s.isSimulating }))}
                className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium transition-all ${
                  state.isSimulating 
                    ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' 
                    : 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-200'
                }`}
              >
                {state.isSimulating ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                {state.isSimulating ? 'Pause' : 'Start Simulation'}
              </button>
              <button
                onClick={handleReset}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium text-slate-600 hover:bg-slate-100 transition-all border border-slate-200"
              >
                <RotateCcw className="w-4 h-4" />
                Reset
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <main className="flex-1 relative flex flex-col">
        {/* Header */}
        <header className="absolute top-0 left-0 right-0 p-8 flex justify-between items-start z-10 pointer-events-none">
          <div className="pointer-events-auto">
            {!showControls && (
              <button 
                onClick={() => setShowControls(true)}
                className="p-3 bg-white shadow-md rounded-full hover:bg-slate-50 transition-colors border border-slate-200 mb-4"
              >
                <ChevronRight className="w-5 h-5 text-blue-600" />
              </button>
            )}
            <div className="bg-white/80 backdrop-blur-sm p-4 rounded-2xl border border-slate-200 shadow-sm max-w-md">
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight mb-1">Physics Scenario</h1>
              <p className="text-sm text-slate-600 leading-relaxed">
                A glass partially filled with water is fastened to a wedge that slides down a large plane inclined at an angle α.
              </p>
            </div>
          </div>

          <div className="pointer-events-auto flex flex-col gap-3 items-end">
            <div className="bg-white/80 backdrop-blur-sm p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-2 min-w-[180px]">
              <div className="flex justify-between text-xs font-medium text-slate-500 uppercase tracking-widest">
                <span>Velocity (m)</span>
                <span className="text-blue-600">{state.vs.toFixed(2)} m/s</span>
              </div>
              <div className="flex justify-between text-xs font-medium text-slate-500 uppercase tracking-widest">
                <span>Velocity (M)</span>
                <span className="text-amber-600">{state.vX.toFixed(2)} m/s</span>
              </div>
              <div className="flex justify-between text-xs font-medium text-slate-500 uppercase tracking-widest">
                <span>Water Angle</span>
                <span className="text-emerald-600">{((state.surfaceAngle * 180) / Math.PI).toFixed(1)}°</span>
              </div>
              <div className="flex justify-between text-xs font-medium text-slate-500 uppercase tracking-widest">
                <span>Time</span>
                <span className="text-slate-900">{state.time.toFixed(2)} s</span>
              </div>
            </div>
            
            <div className="bg-blue-50 border border-blue-100 p-4 rounded-2xl shadow-sm max-w-xs">
              <div className="flex gap-2 items-start">
                <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                <div className="flex flex-col gap-1">
                  <p className="text-[11px] text-blue-800 leading-normal">
                    <strong>Observation:</strong> In a frictionless system, the effective gravity is always perpendicular to the incline.
                  </p>
                  <p className="text-[11px] text-blue-800 leading-normal">
                    <strong>Tip:</strong> You can click and drag the large support (M) to move it horizontally.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Simulation Canvas */}
        <div className="flex-1 w-full h-full cursor-crosshair">
          <canvas 
            ref={canvasRef} 
            className="w-full h-full"
            onMouseDown={handleMouseDown}
          />
        </div>

        {/* Footer Info */}
        <footer className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-4 z-10">
          <div className="px-6 py-3 bg-white/90 backdrop-blur-sm rounded-full border border-slate-200 shadow-lg flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Water Surface</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-slate-400" />
              <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Wedge (m)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-slate-200 border border-slate-300" />
              <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Plane (M)</span>
            </div>
          </div>
        </footer>
      </main>

      {/* Styles for range input */}
      <style dangerouslySetInnerHTML={{ __html: `
        input[type='range']::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          background: #2563eb;
          border: 2px solid white;
          border-radius: 50%;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        input[type='range']::-moz-range-thumb {
          width: 18px;
          height: 18px;
          background: #2563eb;
          border: 2px solid white;
          border-radius: 50%;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
      `}} />
    </div>
  );
}
