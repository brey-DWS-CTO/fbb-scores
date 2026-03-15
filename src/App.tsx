import Header from './components/Header.js'
import Scoreboard from './components/Scoreboard.js'
import LoadingState from './components/LoadingState.js'
import ErrorState from './components/ErrorState.js'
import { useScoreboard } from './hooks/useScoreboard.js'

function App() {
  const { data, isLoading, isError, error, refetch } = useScoreboard()

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f' }}>
      {isLoading && <LoadingState />}
      {isError && (
        <ErrorState
          message={error instanceof Error ? error.message : 'An error occurred'}
          onRetry={refetch}
        />
      )}
      {data && (
        <>
          <Header
            leagueName={data.leagueName}
            playoff={data.playoff}
            fetchedAt={data.fetchedAt}
          />
          <Scoreboard data={data} />
        </>
      )}
    </div>
  )
}

export default App
