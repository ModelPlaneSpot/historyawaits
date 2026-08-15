import { useGameStore } from '@/state/gameStore'
import { MainMenu } from '@/ui/MainMenu'
import { GameScreen } from '@/ui/GameScreen'

function App() {
  const screen = useGameStore((s) => s.screen)
  return <div className="app-root">{screen === 'menu' ? <MainMenu /> : <GameScreen />}</div>
}

export default App
