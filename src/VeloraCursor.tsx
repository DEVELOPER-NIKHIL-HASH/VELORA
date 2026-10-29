
import { useEffect, useState } from "react"

export default function VeloraCursor() {
  const [position, setPosition] = useState({ x: -100, y: -100 })
  const [visible, setVisible] = useState(false)
  const [hovering, setHovering] = useState(false)

  useEffect(() => {
    const move = (event: MouseEvent) => {
      setPosition({ x: event.clientX, y: event.clientY })
      setVisible(true)

      const target = event.target
      setHovering(
        target instanceof Element &&
          !!target.closest(
            "a, button, input, textarea, select, [role='button']"
          )
      )
    }

    const leave = () => setVisible(false)
    const enter = () => setVisible(true)

    window.addEventListener("mousemove", move)
    document.addEventListener("mouseleave", leave)
    document.addEventListener("mouseenter", enter)

    return () => {
      window.removeEventListener("mousemove", move)
      document.removeEventListener("mouseleave", leave)
      document.removeEventListener("mouseenter", enter)
    }
  }, [])

  return (
    <div
      aria-hidden="true"
      className={`velora-cursor ${visible ? "is-visible" : ""} ${
        hovering ? "is-hovering" : ""
      }`}
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      <span />
    </div>
  )
}
