/**
 * Route `#/gallery` (not linked): every shared component and icon in one place, for checking the UI kit on a phone
 * and a laptop. Works without the host.
 */
import { useEffect, useState } from 'react';
import { BLACK_FACES, WHITE_FACES } from '../../data/dice';
import { DEVELOPMENTS } from '../../data/developments';
import { FACTIONS, type FactionId, type Mineral } from '../../data/types';
import { createGame, newPlayer } from '../../engine/create';
import type { GameState } from '../../engine/types';
import { BottomSheet } from '../components/BottomSheet';
import { CodeInput } from '../components/CodeInput';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { ConnectionDot } from '../components/ConnectionDot';
import { DevCard } from '../components/DevCard';
import { FactionBadge } from '../components/FactionBadge';
import { FactionTiles } from '../components/FactionTiles';
import { Menu } from '../components/Menu';
import { MineralPicker } from '../components/MineralPicker';
import { QrCode } from '../components/QrCode';
import { ResourceBar } from '../components/ResourceBar';
import { Stepper } from '../components/Stepper';
import { useFeedback } from '../components/Toast';
import { TurnStrip } from '../components/TurnStrip';
import { navigate } from '../hooks';
import { DieFace, FactionGlyph, Icon, ICON_NAMES } from '../icons';
import { PausedBanner } from './GameHeader';

function sampleGame(turn: FactionId): GameState {
  const g = createGame('ABC234', 'u-a', 'Ann', 'amarr', 0);
  g.players.caldari = newPlayer('caldari', 'Cal', 'u-c');
  g.seats.push('caldari');
  g.phase = 'actions';
  g.round = 2;
  g.turn = { faction: turn, actionTaken: null, deployable: false };
  return g;
}

export function Gallery() {
  const { toast, snackbar } = useFeedback();
  const [count, setCount] = useState(3);
  const [code, setCode] = useState('ABC');
  const [mineral, setMineral] = useState<Mineral | null>('mexallon');
  const [faction, setFaction] = useState<FactionId | null>(null);
  const [sheet, setSheet] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [tick, setTick] = useState(0);
  const [selected, setSelected] = useState(false);

  // Re-render the page every second while the sheet is open: its draft must survive.
  useEffect(() => {
    if (!sheet) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [sheet]);

  return (
    <div className="screen">
      <div className="app-top">
        <header className="app-header" data-faction="caldari">
          <FactionGlyph faction="caldari" size="1.5rem" />
          <div className="app-header-text">
            <span className="app-header-title">UI kit</span>
            <span className="app-header-sub">Component gallery</span>
          </div>
          <ConnectionDot online />
          <ConnectionDot online={false} />
          <Menu
            label="Demo menu"
            items={[
              { id: 'a', label: 'Keep screen on', icon: 'sun', checked: true, onSelect: () => {} },
              { id: 'b', label: 'Invite players (QR)', icon: 'qr', onSelect: () => {} },
              { id: 'c', label: 'Home', icon: 'home', onSelect: () => navigate({ name: 'home' }) },
            ]}
          />
        </header>
        <TurnStrip game={sampleGame('caldari')} me="caldari" onOpen={() => toast('Opens Table')} />
      </div>
      <main className="screen-body stack gallery">
        <section className="stack-sm">
          <h2>Icons</h2>
          <div className="gallery-icons">
            {ICON_NAMES.map((n) => (
              <span key={n} className="gallery-icon">
                <Icon name={n} />
                <span className="small faint">{n}</span>
              </span>
            ))}
          </div>
        </section>
        <section className="stack-sm">
          <h2>Dice</h2>
          <div className="row-wrap">
            {[...new Set(WHITE_FACES)].map((f) => (
              <DieFace key={`w-${f}`} die="white" face={f} />
            ))}
          </div>
          <div className="row-wrap">
            {BLACK_FACES.map((f) => (
              <DieFace key={`b-${f}`} die="black" face={f} />
            ))}
          </div>
        </section>
        <section className="stack-sm">
          <h2>Factions</h2>
          <div className="row-wrap">
            {FACTIONS.map((f) => (
              <FactionBadge key={f} faction={f} player="Player" variant="chip" />
            ))}
          </div>
          <FactionTiles
            tiles={[
              { faction: 'amarr', status: 'mine', player: 'Ann' },
              { faction: 'caldari', status: 'taken', player: 'Cal' },
              { faction: 'gallente', status: 'free' },
              { faction: 'minmatar', status: 'closed' },
            ]}
            value={faction}
            onChange={setFaction}
            label="Demo factions"
          />
        </section>
        <section className="stack-sm">
          <h2>Offline banner</h2>
          <PausedBanner />
        </section>
        <section className="stack-sm">
          <h2>Turn strip</h2>
          <TurnStrip game={sampleGame('amarr')} me="caldari" />
        </section>
        <section className="stack-sm">
          <h2>Resources</h2>
          <ResourceBar res={{ isk: 27, pyrite: 3, mexallon: 2, tritanium: 4, morphite: 1, planetary: 1, moon: 0, component: 2 }} vp={6} highlight={['tritanium']} />
          <ResourceBar res={{ isk: 49, pyrite: 4, mexallon: 3, tritanium: 5, morphite: 1, planetary: 0, moon: 0, component: 0 }} labels={false} />
          <MineralPicker value={mineral} onChange={setMineral} label="Demo mineral" />
        </section>
        <section className="stack-sm">
          <h2>Controls</h2>
          <Stepper label="Tritanium" value={count} onChange={setCount} min={0} max={12} />
          <CodeInput value={code} onChange={setCode} />
          <CodeInput value="ZZZ99K" onChange={() => {}} label="Game code (error state)" error="No game ZZZ·99K on this laptop" />
          <div className="row-wrap">
            <button type="button" className="btn btn-primary">
              Primary
            </button>
            <button type="button" className="btn btn-secondary">
              Secondary
            </button>
            <button type="button" className="btn btn-ghost">
              Ghost
            </button>
            <button type="button" className="btn btn-danger">
              Danger
            </button>
            <button type="button" className="btn btn-primary" disabled>
              Disabled
            </button>
          </div>
          <div className="row-wrap">
            <span className="tag tag-ok">
              <Icon name="check" size="1em" />
              Locked
            </span>
            <span className="tag tag-warn">
              <Icon name="warn" size="1em" />
              Cap
            </span>
            <span className="tag tag-danger">
              <Icon name="danger" size="1em" />
              Invalid
            </span>
            <span className="tag tag-accent">
              <Icon name="info" size="1em" />
              Info
            </span>
          </div>
        </section>
        <section className="stack-sm">
          <h2>Feedback</h2>
          <div className="row-wrap">
            <button type="button" className="btn btn-secondary" onClick={() => snackbar('Built Caracal', { label: 'Undo', onAction: () => toast('Undone: Built Caracal') })}>
              Snackbar
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => toast('Not your turn', 'danger')}>
              Error toast
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => toast('Undone on another device: Cal built Rifter', 'info')}>
              Info toast
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setSheet(true)}>
              Bottom sheet
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setConfirm(true)}>
              Confirm
            </button>
          </div>
        </section>
        <section className="stack-sm">
          <h2>Development card</h2>
          <DevCard dev={DEVELOPMENTS[0]!} selected={selected} onToggle={() => setSelected((s) => !s)} />
          <DevCard dev={DEVELOPMENTS.find((d) => d.prerequisite !== null)!} onPrerequisite={(id) => toast(`Show ${id}`)} />
        </section>
        <section className="stack-sm">
          <h2>QR</h2>
          <div className="gallery-qr">
            <QrCode value="http://192.168.0.162:5180/#/join/ABC234" label="Demo QR" />
          </div>
        </section>
      </main>
      <BottomSheet open={sheet} onClose={() => setSheet(false)} title="Trade" footer={<button className="btn btn-primary btn-block">Confirm · −5 ISK</button>}>
        <div className="stack">
          <p className="muted">The page re-renders every second (tick {tick}); the stepper keeps its value.</p>
          <SheetDraft />
        </div>
      </BottomSheet>
      <ConfirmSheet open={confirm} title="Pass for this round?" confirmLabel="Pass for this round" cancelLabel="Keep playing" onConfirm={() => setConfirm(false)} onCancel={() => setConfirm(false)}>
        <p>You take no more turns until upkeep.</p>
      </ConfirmSheet>
    </div>
  );
}

function SheetDraft() {
  const [n, setN] = useState(1);
  return <Stepper label="Sell tritanium" value={n} onChange={setN} min={0} max={9} />;
}
