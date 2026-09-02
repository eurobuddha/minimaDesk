import HubApp from '../../hub/App';
import { useShell } from '../ShellContext';
import DappWebview from './DappWebview';
import TerminalView from '../views/TerminalView';
import LogsView from '../views/LogsView';
import StoreView from '../views/StoreView';

/**
 * All layers stay mounted; only `display` changes. Webviews must never unmount when switching
 * (that would reload the dapp), and the hub keeps polling/animating behind the scenes.
 */
export default function Stage() {
  const { tabs, activeId, activeTab } = useShell();
  const show = (on: boolean, d = 'block') => ({ display: on ? d : 'none' });
  return (
    <div className="stage">
      <div className="stage-layer stage-home" style={show(activeId === 'home')}>
        <HubApp />
      </div>
      <div className="stage-layer stage-webviews" style={show(activeTab.kind === 'dapp')}>
        {tabs.filter((t) => t.kind === 'dapp').map((t) => (
          <DappWebview key={t.id} tab={t} active={t.id === activeId} />
        ))}
      </div>
      <div className="stage-layer stage-view" style={show(activeId === 'terminal', 'flex')}>
        <TerminalView active={activeId === 'terminal'} />
      </div>
      <div className="stage-layer stage-view" style={show(activeId === 'logs', 'flex')}>
        <LogsView active={activeId === 'logs'} />
      </div>
      <div className="stage-layer stage-view" style={show(activeId === 'store', 'flex')}>
        <StoreView active={activeId === 'store'} />
      </div>
    </div>
  );
}
