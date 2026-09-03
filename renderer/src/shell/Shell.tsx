import type { Ports } from '../minima';
import { ShellProvider } from './ShellContext';
import TitleBar from './TitleBar/TitleBar';
import Stage from './Stage/Stage';
import PendingPrompt from './PendingPrompt';
import ShellNotice from './ShellNotice';

export default function Shell({ ports }: { ports: Ports | null }) {
  return (
    <ShellProvider initialPorts={ports}>
      <div className="shell">
        <TitleBar />
        <Stage />
        <PendingPrompt />
        <ShellNotice />
      </div>
    </ShellProvider>
  );
}
