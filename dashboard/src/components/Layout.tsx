import type { ReactNode } from 'react'
import styles from './Layout.module.css'

interface LayoutProps {
  sidebar: ReactNode
  children: ReactNode
}

export function Layout({ sidebar, children }: LayoutProps) {
  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <h1>Thyra Dashboard</h1>
      </header>
      <div className={styles.body}>
        <aside className={styles.sidebar}>{sidebar}</aside>
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  )
}
