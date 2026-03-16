import { useState } from 'react'
import { Layout } from './components/Layout'
import { VillageSelector } from './components/VillageSelector'
import { WorldPulse } from './components/WorldPulse'
import { ActivityFeed } from './components/ActivityFeed'
import { ChangePanel } from './components/ChangePanel'
import './App.module.css'

export function App() {
  const [selectedVillage, setSelectedVillage] = useState<string | null>(null)

  return (
    <Layout
      sidebar={
        <VillageSelector
          selected={selectedVillage}
          onSelect={setSelectedVillage}
        />
      }
    >
      {selectedVillage ? (
        <>
          <WorldPulse villageId={selectedVillage} />
          <ActivityFeed villageId={selectedVillage} />
          <ChangePanel villageId={selectedVillage} />
        </>
      ) : (
        <div style={{ color: '#666', padding: '2rem', textAlign: 'center' }}>
          Select a village to begin
        </div>
      )}
    </Layout>
  )
}
