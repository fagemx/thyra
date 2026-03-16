import { useState } from 'react'
import { Route, Switch, Link, useLocation } from 'wouter'
import { Layout } from './components/Layout'
import { VillageSelector } from './components/VillageSelector'
import { WorldPulse } from './components/WorldPulse'
import { ActivityFeed } from './components/ActivityFeed'
import { ChangePanel } from './components/ChangePanel'
import { OperatorDashboard } from './pages/OperatorDashboard'
import './App.module.css'

function TonightPage({ villageId }: { villageId: string }) {
  return (
    <>
      <WorldPulse villageId={villageId} />
      <ActivityFeed villageId={villageId} />
      <ChangePanel villageId={villageId} />
    </>
  )
}

function NavLinks() {
  const [location] = useLocation()

  return (
    <nav style={{
      display: 'flex',
      gap: '1rem',
      marginLeft: 'auto',
    }}>
      <Link
        href="/"
        style={{
          color: location === '/' ? '#e94560' : '#888',
          textDecoration: 'none',
          fontSize: '0.875rem',
          fontWeight: location === '/' ? 600 : 400,
        }}
      >
        Tonight
      </Link>
      <Link
        href="/operator"
        style={{
          color: location === '/operator' ? '#e94560' : '#888',
          textDecoration: 'none',
          fontSize: '0.875rem',
          fontWeight: location === '/operator' ? 600 : 400,
        }}
      >
        Operator
      </Link>
    </nav>
  )
}

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
      nav={<NavLinks />}
    >
      {selectedVillage ? (
        <Switch>
          <Route path="/operator">
            <OperatorDashboard villageId={selectedVillage} />
          </Route>
          <Route path="/">
            <TonightPage villageId={selectedVillage} />
          </Route>
        </Switch>
      ) : (
        <div style={{ color: '#666', padding: '2rem', textAlign: 'center' }}>
          Select a village to begin
        </div>
      )}
    </Layout>
  )
}
