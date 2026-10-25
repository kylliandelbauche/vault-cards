import { useEffect, useState } from 'react'

/** Réseau disponible, à jour quand l'appareil passe en ligne / hors ligne. */
export function useOnline(read: () => boolean = () => navigator.onLine): boolean {
  const [online, setOnline] = useState(read)
  useEffect(() => {
    const update = () => setOnline(read())
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [read])
  return online
}
