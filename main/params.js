/*
 * params.js — the COMPLETE minima.jar startup-parameter manifest (from `java -jar minima.jar -help` of the
 * bundled classic jar). Electron-free so it can be required from main AND handed to the renderer as data.
 *
 * Each item: { flag, type, label, help, def, danger? }
 *   type: "bool"   → emitted as `-flag`            (value true/false)
 *         "value"  → emitted as `-flag <string>`   (skipped when blank)
 *         "int"    → same as value, numeric
 *         "secret" → written to the 0600 node.conf (key=value), never on argv, never in config.json
 *
 * Every default is "off"/blank: with nothing changed the node starts EXACTLY as it always has. The jar
 * throws on any flag it does not know (UnknownArgumentException — the node fails to boot), so ALL_FLAGS is
 * the allow-list the raw "additional arguments" field is checked against before anything is saved.
 *
 * MANAGED flags are set by minimaDesk itself (ports, data folder, RPC/MDS, secrets, the -server role from
 * Settings → Network) and are shown read-only so nothing is hidden — but they cannot be overridden here.
 */
const MANAGED = ["data", "basefolder", "port", "rpc", "rpcenable", "rpcpassword", "mdsenable", "mdspassword",
  "conf", "daemon", "server", "seed", "anyseed", "help"];

const MANAGED_INFO = [
  { flag: "data / basefolder", note: "the Data folder above" },
  { flag: "port / rpc",        note: "the Minima port above (RPC = port + 4, MDS = port + 2)" },
  { flag: "rpcenable",         note: "always on — minimaDesk talks to the node over RPC" },
  { flag: "rpcpassword",       note: "generated once, stored encrypted; Settings → minimaDesk → Copy RPC password" },
  { flag: "mdsenable",         note: "always on — the MiniDapp System is what minimaDesk is for" },
  { flag: "mdspassword",       note: "generated once, stored encrypted, handed to the node in the 0600 conf file" },
  { flag: "conf",              note: "the 0600 conf file minimaDesk writes each start (secrets never go on the command line)" },
  { flag: "daemon",            note: "always on — headless (no stdin)" },
  { flag: "server",            note: "Settings → Network → Contribute to the network" },
  { flag: "seed / anyseed",    note: "not a startup parameter here — restore a seed from a wallet MiniDapp or the Terminal" },
];

const GROUPS = [
  { group: "Node role & P2P networking", items: [
    { flag: "host",             type: "value", label: "Host IP (-host)",                  help: "Bind to a specific host IP.", def: "" },
    { flag: "isclient",         type: "bool",  label: "Client node (-isclient)",          help: "Tells the P2P system this node can't accept incoming connections. Not with Contribute to the network.", def: false },
    { flag: "desktop",          type: "bool",  label: "Desktop settings (-desktop)",      help: "Desktop profile: no incoming connections. Not with Contribute to the network.", def: false },
    { flag: "mobile",           type: "bool",  label: "Mobile device (-mobile)",          help: "Marks the device as mobile (metrics only).", def: false },
    { flag: "allowallip",       type: "bool",  label: "Allow all IPs (-allowallip)",      help: "Allow all IPs for Maxima / networking.", def: false },
    { flag: "nop2p",            type: "bool",  label: "Disable P2P (-nop2p)",             help: "Turn off the automatic P2P system.", def: false },
    { flag: "noconnect",        type: "bool",  label: "Hold off connecting (-noconnect)", help: "Don't connect out until this node has been connected to.", def: false },
    { flag: "p2p2",             type: "bool",  label: "New P2P2 system (-p2p2)",          help: "Enable the newer P2P2 subsystem.", def: false },
    { flag: "p2prootnode",      type: "value", label: "P2P root node (-p2prootnode)",     help: "Initial P2P host:port to connect to.", def: "" },
    { flag: "p2pnodes",         type: "value", label: "P2P nodes / list URL (-p2pnodes)", help: "List of nodes, or a URL to a peers file, used when your peers list is empty.", def: "" },
    { flag: "connect",          type: "value", label: "Manual connect list (-connect)",   help: "Disable P2P and connect only to this host:port list.", def: "" },
    { flag: "slavenode",        type: "value", label: "Slave node (-slavenode)",          help: "Connect to this node only; accept only TxBlock messages.", def: "" },
    { flag: "allowgenmessage",  type: "bool",  label: "Allow simple messages (-allowgenmessage)", help: "Allow simple messages sent from peers.", def: false },
  ]},
  { group: "Sync & storage", items: [
    { flag: "nosyncibd",        type: "bool",  label: "Skip IBD (-nosyncibd)",            help: "Don't sync the initial block download (testing).", def: false },
    { flag: "limitbandwidth",   type: "bool",  label: "Limit bandwidth (-limitbandwidth)", help: "Limit the amount sent for archive sync.", def: false },
    { flag: "archive",          type: "bool",  label: "Archive node (-archive)",          help: "Store all data / cascade for resync (large).", def: false },
    { flag: "megammr",          type: "bool",  label: "MegaMMR mode (-megammr)",          help: "Keep the full MegaMMR (serves fast resync; bigger).", def: false },
    { flag: "sqlcoindb",        type: "bool",  label: "SQL coin DB (-sqlcoindb)",         help: "Use a SQL coindb in the txpowtree (low-RAM systems).", def: false },
    { flag: "txpowdbstore",     type: "int",   label: "TxPoW DB days (-txpowdbstore)",    help: "Days to keep TxPoW in the internal H2 DB (node default 3).", def: "" },
    { flag: "syncibdlogs",      type: "bool",  label: "Verbose sync logs (-syncibdlogs)", help: "Show detailed SYNC_IBD logs.", def: false },
    { flag: "rescuenode",       type: "value", label: "Rescue node (-rescuenode)",        help: "MegaMMR node to resync from if you meet a heavier chain.", def: "" },
    { flag: "megaprune",        type: "bool",  label: "Prune MegaMMR (-megaprune)",       help: "Prune unspendable addresses from the megammr.", def: false },
    { flag: "megaprunestate",   type: "bool",  label: "Prune state coins (-megaprunestate)", help: "Prune all coins with a state (exchanges).", def: false },
    { flag: "megaprunetokens",  type: "bool",  label: "Prune tokens (-megaprunetokens)",  help: "Prune all tokens; keep only Minima coins.", def: false },
    { flag: "clean",            type: "bool",  label: "Wipe data at startup (-clean) ⚠",  help: "DANGER: wipes the data folder at startup — chain, wallet and installed MiniDapps.", def: false, danger: true },
  ]},
  { group: "MiniDapp System (MDS)", items: [
    { flag: "mdsinit",          type: "value", label: "MiniDapp folder (-mdsinit)",       help: "A folder of .mds.zip files to install at startup.", def: "" },
    { flag: "mdswrite",         type: "value", label: "Initial write access (-mdswrite)", help: "Give this MiniDapp WRITE access on install.", def: "" },
    { flag: "nodefaultminidapps", type: "bool", label: "No default MiniDapps (-nodefaultminidapps)", help: "Do NOT install the node's default MiniDapps.", def: false },
    { flag: "nosslmds",         type: "bool",  label: "No SSL for MDS (-nosslmds) ⚠",     help: "Disable the self-signed MDS cert. minimaDesk loads MiniDapps over https — leave off unless you run your own SSL proxy.", def: false, danger: true },
    { flag: "publicmds",        type: "bool",  label: "Public MDS (-publicmds)",          help: "Enable the Public MDS system.", def: false },
    { flag: "publicmdsuid",     type: "value", label: "Public MDS session ID (-publicmdsuid)", help: "Your own Session ID for the Public MDS (also enables it).", def: "" },
  ]},
  { group: "Security & database", items: [
    { flag: "dbpassword",       type: "secret", label: "Wallet DB password (-dbpassword) ⚠", help: "Main wallet / SQL AES password. MUST be set on the node's first launch and CANNOT be changed later. Stored encrypted, passed in the conf file.", def: "" },
    { flag: "rpcssl",           type: "bool",  label: "RPC over SSL (-rpcssl) ⚠",         help: "Self-signed SSL for RPC. minimaDesk talks plain http to 127.0.0.1 — leave off.", def: false, danger: true },
    { flag: "dbignorelocks",    type: "bool",  label: "Ignore DB locks (-dbignorelocks)", help: "Debug: stop the DB checking locks.", def: false },
  ]},
  { group: "MySQL backup", items: [
    { flag: "mysqldb",          type: "secret", label: "MySQL DSN (-mysqldb)",            help: "Full MySQL details username:password@host:port. Stored encrypted, passed in the conf file.", def: "" },
    { flag: "mysqldbcoins",     type: "bool",  label: "MySQL coins backup (-mysqldbcoins)", help: "Enable the MySQL coins DB backup.", def: false },
    { flag: "mysqldbdelay",     type: "int",   label: "MySQL connect delay ms (-mysqldbdelay)", help: "Delay before the first MySQL connection (Docker).", def: "" },
    { flag: "mysqlalltxpow",    type: "bool",  label: "MySQL all TxPoW (-mysqlalltxpow)", help: "Store all TxPoW in MySQL when autobackup is on.", def: false },
  ]},
  { group: "Test / private network", items: [
    { flag: "solo",             type: "bool",  label: "Solo private net (-solo) ⚠",       help: "Run a private network (-test -nop2p); genesis on first run. Leaves the real Minima network.", def: false, danger: true },
    { flag: "test",             type: "bool",  label: "Test params (-test) ⚠",            help: "Use test params on a private network.", def: false, danger: true },
    { flag: "genesis",          type: "bool",  label: "Genesis block (-genesis) ⚠",       help: "Create a genesis block — implies -clean (wipes data) and -automine.", def: false, danger: true },
    { flag: "testchainlength",  type: "int",   label: "Test chain length (-testchainlength)", help: "Tree length to keep in -test mode (default 32).", def: "" },
  ]},
  { group: "Logging & advanced", items: [
    { flag: "showparams",       type: "bool",  label: "Show startup params (-showparams)", help: "Print the startup params on launch (in Node logs).", def: false },
    { flag: "shownetcalls",     type: "bool",  label: "Show network calls (-shownetcalls)", help: "Log all network calls.", def: false },
    { flag: "shownetcallsnopoll", type: "bool", label: "Show net calls, no poll (-shownetcallsnopoll)", help: "Log network calls except poll messages.", def: false },
    { flag: "p2p-log-level-info", type: "bool", label: "P2P log: info (-p2p-log-level-info)", help: "Set the P2P log level to info.", def: false },
    { flag: "p2p-log-level-debug", type: "bool", label: "P2P log: debug (-p2p-log-level-debug)", help: "Set the P2P log level to debug.", def: false },
    { flag: "notifyalltxpow",   type: "bool",  label: "Notify all TxPoW (-notifyalltxpow)", help: "Notifications for ALL TxPoW, not just relevant ones.", def: false },
    { flag: "rpccrlf",          type: "bool",  label: "RPC CRLF headers (-rpccrlf)",      help: "Use CRLF at the end of RPC headers (NodeJS).", def: false },
    { flag: "jnlp",             type: "bool",  label: "JNLP (-jnlp)",                     help: "Running from JNLP.", def: false },
    { flag: "noshutdownhook",   type: "bool",  label: "No shutdown hook (-noshutdownhook)", help: "Don't use the shutdown hook (Android).", def: false },
  ]},
];

const ITEMS = [];
for (const g of GROUPS) for (const it of g.items) ITEMS.push(it);
const BY_FLAG = new Map(ITEMS.map((it) => [it.flag, it]));
/** Every flag the bundled jar accepts (manifest + managed) — the allow-list for raw extra arguments. */
const ALL_FLAGS = new Set([...ITEMS.map((it) => it.flag), ...MANAGED]);

function defaultParams() {
  const out = {};
  for (const it of ITEMS) out[it.flag] = it.def;
  return out;
}

module.exports = { GROUPS, ITEMS, BY_FLAG, MANAGED, MANAGED_INFO, ALL_FLAGS, defaultParams };
