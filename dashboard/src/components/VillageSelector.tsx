import { useEffect, useState } from 'react'
import { listVillages, ApiError } from '../api/client'
import type { Village } from '../api/types'
import styles from './VillageSelector.module.css'

interface VillageSelectorProps {
  selected: string | null
  onSelect: (id: string) => void
}

export function VillageSelector({ selected, onSelect }: VillageSelectorProps) {
  const [villages, setVillages] = useState<Village[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listVillages()
      .then((data) => {
        if (!cancelled) {
          setVillages(data)
          setError(null)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load villages')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  if (loading) return <div className={styles.status}>Loading villages...</div>
  if (error) return <div className={styles.error}>{error}</div>

  return (
    <div className={styles.selector}>
      <h3 className={styles.title}>Villages</h3>
      {villages.length === 0 && (
        <p className={styles.empty}>No villages found</p>
      )}
      <ul className={styles.list}>
        {villages.map((v) => (
          <li key={v.id}>
            <button
              className={`${styles.item} ${selected === v.id ? styles.active : ''}`}
              onClick={() => onSelect(v.id)}
            >
              <span className={styles.name}>{v.name}</span>
              <span className={styles.badge}>{v.status}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
