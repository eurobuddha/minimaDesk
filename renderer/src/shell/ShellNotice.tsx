import { useShell } from './ShellContext';

/** Small bottom-centre pill for shell-level messages ("Installing Terminal IDE… it will open automatically"). */
export default function ShellNotice() {
  const { notice } = useShell();
  if (!notice) return null;
  return <div className="shell-notice">{notice}</div>;
}
