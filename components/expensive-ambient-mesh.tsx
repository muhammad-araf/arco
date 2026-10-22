'use client'

import * as React from 'react'

interface ExpensiveAmbientMeshProps {
  showBeam?: boolean
  showGrid?: boolean
  className?: string
}

export function ExpensiveAmbientMesh({
  showBeam = true,
  showGrid = true,
  className = '',
}: ExpensiveAmbientMeshProps) {
  return (
    <div 
      className={`expensive-aurora-canvas pointer-events-none select-none ${className}`}
      aria-hidden="true"
    >
      {/* Top Center Primary Emerald / Cyan Aurora Light Orb */}
      <div className="expensive-orb-primary" />

      {/* Top Right Amber / Golden Harvest Refraction Orb */}
      <div className="expensive-orb-secondary" />

      {/* Bottom Left Subtle Warm Earth Tone */}
      <div className="expensive-orb-tertiary" />

      {/* Precision Architectural Dot Matrix with Radial Vignette */}
      {showGrid && <div className="expensive-dot-grid" />}

      {/* Luminous Top Light Beam Sweep */}
      {showBeam && <div className="expensive-glow-beam" />}
    </div>
  )
}
