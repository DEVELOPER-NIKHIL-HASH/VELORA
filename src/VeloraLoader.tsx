import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "motion/react"

export default function VeloraLoader() {
  const [show, setShow] = useState(true)

  useEffect(() => {
    const timer = window.setTimeout(() => setShow(false), 1800)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.65 }}
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-[#050505]"
        >
          <div className="flex flex-col items-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.75, rotate: -12 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="flex h-20 w-20 items-center justify-center rounded-2xl border border-[#D4AF37]/70 text-5xl font-serif text-[#D4AF37]"
              style={{ boxShadow: "0 0 45px rgba(212,175,55,0.12)" }}
            >
              V
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, letterSpacing: "0.45em" }}
              animate={{ opacity: 1, letterSpacing: "0.3em" }}
              transition={{ delay: 0.25, duration: 0.7 }}
              className="mt-6 text-xl font-light text-white"
            >
              VELORA
            </motion.h1>

            <motion.div className="mt-6 h-px w-32 overflow-hidden bg-white/15">
              <motion.div
                initial={{ x: "-100%" }}
                animate={{ x: "0%" }}
                transition={{ duration: 1.1, ease: "easeInOut" }}
                className="h-full w-full bg-[#D4AF37]"
              />
            </motion.div>

            <p className="mt-3 text-[9px] tracking-[0.35em] text-white/40">
              THE ART OF COMMERCE
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
