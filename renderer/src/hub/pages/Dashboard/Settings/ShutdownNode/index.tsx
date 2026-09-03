import { useContext, useState } from 'react';
import Modal from '../../../../components/UI/Modal';
import Button from '../../../../components/UI/Button';
import { appContext } from '../../../../AppContext';

type ShutdownProps = {
  display: boolean;
  dismiss: () => void;
};

export function ShutdownNode({ display, dismiss }: ShutdownProps) {
  const { setHasShutdown, notify } = useContext(appContext);
  const [shutdown, setShutdown] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [compactDatabase, setCompactDatabase] = useState(false);

  const [restarting, setRestarting] = useState(false);

  // minimaDesk: stop the node child that the app owns (optionally compacting its databases)
  const confirm = async () => {
    setIsLoading(true);
    let r: any = null;
    try { r = await (window as any).minima.nodeStop(compactDatabase); } catch (e: any) { r = { status: false, error: e && e.message }; }
    setIsLoading(false);
    if (!r || !r.status) {
      notify('Shutdown failed: ' + ((r && r.error) || 'unknown error'));
      return;
    }
    setShutdown(true);
    setHasShutdown(true);
  };

  const restart = async () => {
    setRestarting(true);
    let r: any = null;
    try { r = await (window as any).minima.nodeRestart(); } catch (e: any) { r = { status: false, error: e && e.message }; }
    setRestarting(false);
    if (!r || !r.status) {
      notify('Restart failed: ' + ((r && r.error) || 'unknown error'));
      return;
    }
    setShutdown(false);
    setHasShutdown(false);
    dismiss();
  };

  const toggleCompactDatabase = () => {
    setCompactDatabase(prevState => !prevState);
  }

  if (shutdown) {
    return (
      <Modal display={display} frosted>
        <div>
          <div className="text-center">
            <h1 className="text-xl mb-8">Your node has been shut down</h1>
            <Button onClick={restart} loading={restarting}>Restart node</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      frosted
      display={display}
      closeAtBottom={dismiss}
      hideCloseAtBottomDesktop
    >
      <div
        className={`absolute z-20 top-0 left-0 w-full h-full core-black-contrast-2 text-white ${
          isLoading ? 'flex items-center justify-center' : 'hidden'
        }`}
      >
        <div className="flex flex-col items-center mt-6 gap-6">
          <div className="spinner" />
          <div className="text-gray-400">Please wait</div>
        </div>
      </div>
      <div className="mb-1">
        <div className="text-center">
          <h5 className="text-2xl mb-6">Shutdown node</h5>
          <p className="mb-8">If your node does not restart automatically, please restart it to resync to the chain</p>
          <div className="mb-10 flex item-center justify-center">
            <label className="flex items-center">
              <input type="checkbox" className="checkbox mr-4" onClick={toggleCompactDatabase} />
              Compact database
            </label>
          </div>
          <Button onClick={confirm}>Shutdown node</Button>
          <div className="block mt-4">
            <Button onClick={dismiss} variant="secondary">
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default ShutdownNode;
