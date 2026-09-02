import FixedModal from '../hub/components/UI/FixedModal';
import Button from '../hub/components/UI/Button';
import { useShell } from './ShellContext';

/**
 * A read-mode MiniDapp asked the node to do something that needs write permission (send, install, …).
 * Shown over whatever tab is active — the hub's own Pending dapp still lists everything.
 */
export default function PendingPrompt() {
  const { pending, acceptPending, denyPending, snoozePending } = useShell();
  const p = pending[0];
  const dapp = p && p.minidapp && p.minidapp.conf ? p.minidapp.conf : null;
  const isInstall = p && /mds\s+action:install/i.test(String(p.command || ''));

  return (
    <FixedModal display={!!p} frosted>
      {p && (
        <div className="text-center">
          <h1 className="text-2xl mb-2">{dapp ? dapp.name : 'A MiniDapp'}{dapp && dapp.version ? <span className="text-core-grey-80 text-base"> v{dapp.version}</span> : null}</h1>
          <p className="text-core-grey-20 mb-4">{isInstall ? 'wants to install a MiniDapp' : 'wants to run a command that needs write permission'}</p>
          {!isInstall && <code className="pending-cmd text-left">{p.command}</code>}
          {isInstall && <code className="pending-cmd text-left">{p.command}</code>}
          <Button onClick={() => acceptPending(p.uid)}>Allow</Button>
          <div className="mt-3"><Button variant="secondary" onClick={() => denyPending(p.uid)}>Deny</Button></div>
          <div className="mt-4 text-sm text-core-grey-80 cursor-pointer hover:text-white" onClick={() => snoozePending(p.uid)}>Decide later (stays in Pending)</div>
        </div>
      )}
    </FixedModal>
  );
}
