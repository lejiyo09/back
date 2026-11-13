import './style.css';
import { randomSeed } from '@shared/Random';
import type { PlayerInfo, GameMode } from '@shared/GameTypes';
import { loadSettings, saveSettings, URL_FLAGS, type Settings } from './core/GameConfig';
import { Game } from './core/Game';
import { MainMenu } from './ui/MainMenu';
import { buildSettingsPanel } from './ui/SettingsUI';
import { NetworkManager } from './multiplayer/NetworkManager';
import { SaveGame, type CarryState } from './core/SaveGame';
import { MAX_LEVEL, nextLevelSeed } from '@shared/Levels';

/**
 * App shell: title screen → (lobby) → game → back to title.
 * Single-player never opens a network connection.
 */
class App {
  private settings: Settings = loadSettings();
  private menu: MainMenu;
  private game?: Game;
  private net?: NetworkManager;
  private lobbyPlayers: PlayerInfo[] = [];

  constructor() {
    this.menu = new MainMenu({
      single: (name) => this.startSingle(name),
      resume: (name) => this.resumeSave(name),
      host: (name) => void this.host(name),
      join: (code, name) => void this.join(code, name),
      settings: () => this.openSettings(),
      lobbyStart: () => this.net?.socket.emit('game:start'),
      lobbyLeave: () => this.leaveLobby(),
    }, this.settings.playerName);

    this.refreshResume();
    if (URL_FLAGS.autostart === 'single') this.startSingle('Survivor');
    const auto = /^level(\d+)$/.exec(URL_FLAGS.autostart ?? '');
    if (auto && Number(auto[1]) >= 1 && Number(auto[1]) <= MAX_LEVEL) {
      void this.launch('single', URL_FLAGS.seed ?? randomSeed(), 'SOLO', [{ id: 'local', name: 'Survivor', isHost: true, online: true }], Number(auto[1]));
    }
  }

  private refreshResume(): void {
    const save = SaveGame.load();
    const lv = save?.chapter ?? 1;
    this.menu.setResume(save ? (save.ending ? `Level ${lv} 다시 하기 (엔딩 ${save.ending} 달성)` : save.completed ? `이어하기 — Level ${Math.min(MAX_LEVEL, lv + 1)}` : `이어하기 — Level ${lv}`) : null);
  }

  private resumeSave(name: string): void {
    const save = SaveGame.load();
    if (!save) return;
    this.rememberName(name);
    // finished Level 1 but never started Level 2 → go straight on to Level 2
    const level = save.completed && !save.ending && save.chapter < MAX_LEVEL ? save.chapter + 1 : save.chapter;
    const seed = level !== save.chapter ? nextLevelSeed(save.seed, level) : save.seed;
    void this.launch('single', seed, 'SOLO', [{ id: 'local', name, isHost: true, online: true }], level, save.carry);
  }

  /** Ending B → Level 1, Level 1's stairs → Level 2. Single-player swaps immediately; the host moves the whole room. */
  private continueToNextLevel(): void {
    if (!this.game) return;
    const next = Math.min(MAX_LEVEL, this.game.level + 1);
    if (this.game.session.mode === 'host') { this.net?.socket.emit('game:level', { level: next }); return; }
    const carry = this.game.carryState();
    const seed = nextLevelSeed(this.game.session.mapSeed, next);
    const players = [...this.game.session.players.values()];
    this.game.exit(undefined, true);
    void this.launch('single', seed, 'SOLO', players, next, carry);
  }

  private rememberName(name: string): void {
    this.settings.playerName = name;
    saveSettings(this.settings);
  }

  openSettings(onClose?: () => void): void {
    const panel = buildSettingsPanel(this.settings, (s, key) => {
      saveSettings(s);
      if (key !== 'quality') this.game?.applySettings(s);
    }, () => { panel.remove(); onClose?.(); });
    document.body.appendChild(panel);
  }

  private startSingle(name: string): void {
    this.rememberName(name);
    void this.launch('single', URL_FLAGS.seed ?? randomSeed(), 'SOLO', [{ id: 'local', name, isHost: true, online: true }]);
  }

  private ensureNet(): NetworkManager {
    if (!this.net) this.net = new NetworkManager();
    return this.net;
  }

  private bindLobby(net: NetworkManager): void {
    const s = net.socket;
    s.off('session:peer-joined').on('session:peer-joined', (p) => {
      this.lobbyPlayers.push(p);
      this.menu.updateLobbyPlayers(this.lobbyPlayers, net.isHost);
    });
    s.off('session:peer-left').on('session:peer-left', (id) => {
      this.lobbyPlayers = this.lobbyPlayers.filter((p) => p.id !== id);
      this.menu.updateLobbyPlayers(this.lobbyPlayers, net.isHost);
    });
    s.off('session:peer-offline').on('session:peer-offline', (id) => {
      this.lobbyPlayers = this.lobbyPlayers.map((p) => (p.id === id ? { ...p, online: false } : p));
      if (!this.game) this.menu.updateLobbyPlayers(this.lobbyPlayers, net.isHost);
    });
    s.off('session:peer-online').on('session:peer-online', (id) => {
      this.lobbyPlayers = this.lobbyPlayers.map((p) => (p.id === id ? { ...p, online: true } : p));
      if (!this.game) this.menu.updateLobbyPlayers(this.lobbyPlayers, net.isHost);
    });
    s.off('session:host-changed').on('session:host-changed', (hostId) => {
      this.lobbyPlayers = this.lobbyPlayers.map((p) => ({ ...p, isHost: p.id === hostId }));
      if (!this.game) this.menu.updateLobbyPlayers(this.lobbyPlayers, net.isHost);
    });
    s.off('session:ended').on('session:ended', (reason) => {
      if (!this.game) { this.menu.show(); this.menu.showError(reason); }
    });
    s.off('game:level').on('game:level', ({ level, seed }) => {
      const carry = this.game?.carryState();
      this.game?.exit(undefined, true);
      const info = net.session!;
      info.seed = seed;
      info.level = level;
      void this.launch(net.isHost ? 'host' : 'client', seed, info.code, this.lobbyPlayers, level, carry);
    });
    s.off('game:started').on('game:started', () => {
      const info = net.session!;
      void this.launch(net.isHost ? 'host' : 'client', info.seed, info.code, this.lobbyPlayers);
    });
  }

  private async host(name: string): Promise<void> {
    this.rememberName(name);
    this.menu.setBusy(true);
    try {
      const net = this.ensureNet();
      const info = await net.createSession(name);
      this.lobbyPlayers = [...info.players];
      this.bindLobby(net);
      this.menu.showLobby(true, info.code, this.lobbyPlayers, true);
    } catch (e) {
      this.menu.showError(`${(e as Error).message} — 멀티플레이 서버(npm run dev)가 실행 중인지 확인하세요.`);
    } finally {
      this.menu.setBusy(false);
    }
  }

  private async join(code: string, name: string): Promise<void> {
    this.rememberName(name);
    this.menu.setBusy(true);
    try {
      const net = this.ensureNet();
      const info = await net.joinSession(code, name);
      this.lobbyPlayers = [...info.players];
      this.bindLobby(net);
      if (info.started) {
        await this.launch('client', info.seed, info.code, this.lobbyPlayers, info.level ?? 0);
      } else {
        this.menu.showLobby(true, info.code, this.lobbyPlayers, false);
      }
    } catch (e) {
      this.menu.showError((e as Error).message);
    } finally {
      this.menu.setBusy(false);
    }
  }

  private leaveLobby(): void {
    this.net?.leave();
    this.menu.showLobby(false);
  }

  private async launch(mode: GameMode, seed: number, sessionId: string, players: PlayerInfo[], level = 0, carry?: CarryState): Promise<void> {
    if (this.game) return;
    if (level >= 1 && mode === 'single') {
      SaveGame.save({ chapter: level, seed, carry: carry ?? { recorder: true, heard: [0], deaths: 0, time: 0, battery: 100 }, completed: false });
    }
    document.querySelector('canvas#view')?.remove();
    const canvas = document.createElement('canvas');
    canvas.id = 'view';
    document.body.prepend(canvas);
    this.menu.root.classList.remove('hidden');
    this.menu.setLoading('준비 중', 0);
    try {
      const game = await Game.create({
        canvas,
        settings: this.settings,
        mode,
        seed,
        sessionId,
        players,
        net: mode === 'single' ? undefined : this.net,
        level,
        carry,
        onContinue: mode === 'client' ? () => undefined : () => this.continueToNextLevel(),
        onProgress: (step, p) => this.menu.setLoading(step, p),
        onExit: (reason, transition) => this.onGameExit(reason, transition),
        openSettings: (onClose) => this.openSettings(onClose),
      });
      this.game = game;
      this.menu.hide();
      game.start();
    } catch (e) {
      console.error(e);
      canvas.remove();
      this.menu.show();
      this.menu.showError(`게임을 시작하지 못했습니다: ${(e as Error).message}`);
    }
  }

  private onGameExit(reason?: string, transition = false): void {
    this.game = undefined;
    document.querySelector('canvas#view')?.remove();
    if (transition) return; // moving to another level: keep the session, the next launch shows its own loading screen
    this.net?.leave();
    this.lobbyPlayers = [];
    this.menu.show();
    this.refreshResume();
    if (reason) this.menu.showError(reason);
  }
}

new App();
