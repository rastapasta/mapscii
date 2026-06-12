/*
  MapSCII - Terminal Map Viewer

  Cross-platform input handler using terminal-kit
  Supports keyboard, mouse, and scroll events on all platforms including Windows Terminal
*/

import { terminal as term } from 'terminal-kit';

export interface InputEvent {
  type: 'key' | 'mouse' | 'scroll' | 'resize';
  key?: string;
  x?: number;
  y?: number;
  button?: 'left' | 'middle' | 'right' | 'none';
  action?: 'press' | 'release' | 'move' | 'drag';
  delta?: number;
}

interface MouseData {
  x: number;
  y: number;
  left?: boolean;
  right?: boolean;
}

interface KeyData {
  isCharacter: boolean;
  codepoint?: number;
  code?: Buffer;
}

type EventCallback = (event: InputEvent) => void;
type KeyHandler = (name: string, matches: string[], data: KeyData) => void;
type MouseHandler = (name: string, data: MouseData) => void;
type ResizeHandler = (width: number, height: number) => void;

// Export for direct access if needed
export { term };

/**
 * Map terminal-kit key names to our key names. Single printable characters
 * keep their case so uppercase bindings (e.g. S, R) can fire; consumers fall
 * back to the lowercase binding themselves (see Mapscii._onKey).
 */
export function normalizeKeyName(name: string): string {
  if (name === 'UP') return 'up';
  if (name === 'DOWN') return 'down';
  if (name === 'LEFT') return 'left';
  if (name === 'RIGHT') return 'right';
  if (name === 'ESCAPE') return 'escape';
  if (name === 'CTRL_C') return 'q';
  if (name.length > 1) return name.toLowerCase();
  return name;
}

export default class InputHandler {
  private callback: EventCallback | null = null;
  private enabled: boolean = false;
  private mouseButtonDown: boolean = false;
  private keyHandler: KeyHandler | null = null;
  private mouseHandler: MouseHandler | null = null;
  private resizeHandler: ResizeHandler | null = null;

  constructor(_input: NodeJS.ReadStream, _output: NodeJS.WriteStream) {
    // We use terminal-kit's terminal directly, ignoring passed streams
  }

  start(callback: EventCallback): void {
    this.callback = callback;
    this.enabled = true;

    // Enable mouse tracking with motion - exactly like test-mouse.ts
    term.grabInput({ mouse: 'motion' });

    // Create bound handlers so we can remove them later
    this.keyHandler = (name: string, _matches: string[], _data: KeyData) => {
      this._handleKey(name);
    };

    this.mouseHandler = (name: string, data: MouseData) => {
      this._handleMouse(name, data);
    };

    this.resizeHandler = (width: number, height: number) => {
      this._handleResize(width, height);
    };

    // Set up event handlers
    term.on('key', this.keyHandler);
    term.on('mouse', this.mouseHandler);
    term.on('resize', this.resizeHandler);
  }

  private _handleKey(name: string): void {
    if (!this.enabled || !this.callback) return;

    this.callback({ type: 'key', key: normalizeKeyName(name) });
  }

  private _handleMouse(name: string, data: MouseData): void {
    if (!this.enabled || !this.callback) return;

    const x = data.x;
    const y = data.y;

    if (name === 'MOUSE_LEFT_BUTTON_PRESSED') {
      this.mouseButtonDown = true;
      this.callback({ type: 'mouse', x, y, action: 'press', button: 'left' });
    } else if (name === 'MOUSE_LEFT_BUTTON_RELEASED' || name === 'MOUSE_BUTTON_RELEASED') {
      this.mouseButtonDown = false;
      this.callback({ type: 'mouse', x, y, action: 'release', button: 'left' });
    } else if (name === 'MOUSE_MIDDLE_BUTTON_PRESSED') {
      this.callback({ type: 'mouse', x, y, action: 'press', button: 'middle' });
    } else if (name === 'MOUSE_RIGHT_BUTTON_PRESSED') {
      this.callback({ type: 'mouse', x, y, action: 'press', button: 'right' });
    } else if (name === 'MOUSE_WHEEL_UP') {
      this.callback({ type: 'scroll', x, y, delta: 1 });
    } else if (name === 'MOUSE_WHEEL_DOWN') {
      this.callback({ type: 'scroll', x, y, delta: -1 });
    } else if (name === 'MOUSE_MOTION') {
      if (this.mouseButtonDown) {
        this.callback({ type: 'mouse', x, y, action: 'drag', button: 'left' });
      } else {
        this.callback({ type: 'mouse', x, y, action: 'move', button: 'none' });
      }
    } else if (name === 'MOUSE_DRAG') {
      this.callback({
        type: 'mouse',
        x,
        y,
        action: 'drag',
        button: data.left ? 'left' : (data.right ? 'right' : 'none')
      });
    }
  }

  private _handleResize(_width: number, _height: number): void {
    if (!this.enabled || !this.callback) return;
    this.callback({ type: 'resize' });
  }

  stop(): void {
    this.enabled = false;

    // Remove event listeners
    if (this.keyHandler) {
      term.off('key', this.keyHandler);
    }
    if (this.mouseHandler) {
      term.off('mouse', this.mouseHandler);
    }
    if (this.resizeHandler) {
      term.off('resize', this.resizeHandler);
    }

    // Disable input grabbing
    term.grabInput(false);
  }
}
