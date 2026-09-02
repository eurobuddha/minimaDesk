import { ShellProvider } from './ShellContext';
import TitleBar from './TitleBar/TitleBar';
import Stage from './Stage/Stage';
import PendingPrompt from './PendingPrompt';

export default function Shell() {
  return (
    <ShellProvider>
      <div className="shell">
        <TitleBar />
        <Stage />
        <PendingPrompt />
      </div>
    </ShellProvider>
  );
}
