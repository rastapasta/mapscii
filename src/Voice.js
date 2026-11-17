// Speaks with the system's speech program (spd-say, espeak, say, PowerShell). Only the newest waiting sentence is kept.
'use strict';
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const ENGINES = {
  linux: [['spd-say', (text) => ['-w', text]], ['espeak-ng', (text) => [text]], ['espeak', (text) => [text]]],
  darwin: [['say', (text) => [text]]],
  // the text goes in an environment variable, never into the command
  win32: [['powershell', () => ['-NoProfile', '-Command',
    'Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak($env:MAPSCII_SAY)']]],
};

// Whether a program is on the PATH
function onPath(program) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  const names = process.platform === 'win32' ? [`${program}.exe`, program] : [program];
  return dirs.some((dir) => names.some((name) => {
    try {
      fs.accessSync(path.join(dir, name), fs.constants.X_OK);
      return true;
    } catch (error) {
      return false;
    }
  }));
}

class Voice {
  // options: {engine: [program, args(text)], spawn (for tests)}
  constructor({engine = undefined, spawn = childProcess.spawn, platform = process.platform} = {}) {
    this.engine = engine !== undefined ? engine : (ENGINES[platform] || ENGINES.linux).find(([program]) => onPath(program)) || null;
    this.spawn = spawn;
    this.speaking = false;
    this.waiting = null;
    this.on = true;
  }

  // Whether a speech program was found
  get available() {
    return !!this.engine;
  }

  // The speech program's name
  get name() {
    return this.engine ? this.engine[0] : null;
  }

  // Says a sentence, or keeps it as the next one; returns whether it will be said
  say(text) {
    if (!this.on || !this.engine || !text) return false;
    if (this.speaking) {
      this.waiting = text;
      return true;
    }
    this._speak(text);
    return true;
  }

  // Runs the speech program, then says the waiting sentence
  _speak(text) {
    const [program, args] = this.engine;
    this.speaking = true;
    let child;
    try {
      child = this.spawn(program, args(text), {stdio: 'ignore', env: Object.assign({}, process.env, {MAPSCII_SAY: text})});
    } catch (error) {
      this._failed();
      return;
    }
    child.on('error', () => this._failed());
    child.on('exit', () => {
      this.speaking = false;
      const next = this.waiting;
      this.waiting = null;
      if (next && this.on) this._speak(next);
    });
  }

  // Goes silent for good when the program can't run
  _failed() {
    this.speaking = false;
    this.waiting = null;
    this.engine = null;
  }
}

Voice.ENGINES = ENGINES;
module.exports = Voice;
