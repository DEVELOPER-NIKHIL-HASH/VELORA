import { useState } from "react"
import { motion } from "motion/react"

type VeloraImageProps = {
  src: string
  alt: string
  className?: string
  animated?: boolean
  onClick?: () => void
}

export default function VeloraImage({
  src,
  alt,
  className = "",
  animated = false,
  onClick,
}: VeloraImageProps) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  return (
    <div className={`relative ${className}`}>
      {!loaded && !failed && (
        <div className="absolute inset-0 z-10 animate-pulse rounded-[inherit] bg-gradient-to-r from-[#e8e3da] via-[#f5e7b2] to-[#e8e3da]" />
      )}

      {failed ? (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-[inherit] bg-[#eee8dc] p-3 text-center">
          <span className="text-sm text-black/60">Image unavailable</span>
          <button
            type="button"
            onClick={() => {
              setFailed(false)
              setLoaded(false)
              setAttempt((current) => current + 1)
            }}
            className="rounded-full border border-[#b89636] px-4 py-2 text-sm hover:bg-[#D4AF37]"
          >
            Retry
          </button>
        </div>
      ) : (
        <motion.img
          key={attempt}
          src={src}
          alt={alt}
          onLoad={() => setLoaded(true)}
          onError={() => {
            setLoaded(false)
            setFailed(true)
          }}
          onClick={onClick}
          whileHover={animated ? { scale: 1.06 } : undefined}
          transition={{ duration: 0.5 }}
          className={`${className} relative block transition-opacity duration-300 ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
    </div>
  )
}
