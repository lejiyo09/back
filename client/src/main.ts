import './style.css';
import { randomSeed } from '@shared/Random';
import type { PlayerInfo, GameMode } from '@shared/GameTypes';
import { loadSettings, saveSettings, URL_FLAGS, type Settings } from './core/GameConfig';
import { Game } from './core/Game';
import { MainMenu } from './ui/MainMenu';
import { buildSettingsPanel } from './ui/SettingsUI';
import { NetworkManager } from './multiplayer/NetworkManager';

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
      host: (name) => void this.host(name),
      join: (code, name) => void this.join(code, name),
      settings: () => this.openSettings(),
      lobbyStart: () => this.net?.socket.emit('game:start'),
      lobbyLeave: () => this.leaveLobby(),
    }, this.settings.playerName);

    if (URL_FLAGS.autostart === 'single') this.startSingle('Survivor');
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
        await this.launch('client', info.seed, info.code, this.lobbyPlayers);
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

  private async launch(mode: GameMode, seed: number, sessionId: string, players: PlayerInfo[]): Promise<void> {
    if (this.game) return;
    document.querySelector('canvas#view')?.remove();
    const canvas = document.createElement('canvas');
    canvas.id = 'view';
    document.body.prepend(canvas);
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
        onProgress: (step, p) => this.menu.setLoading(step, p),
        onExit: (reason) => this.onGameExit(reason),
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

  private onGameExit(reason?: string): void {
    this.game = undefined;
    document.querySelector('canvas#view')?.remove();
    this.net?.leave();
    this.lobbyPlayers = [];
    this.menu.show();
    if (reason) this.menu.showError(reason);
  }
}

new App();
