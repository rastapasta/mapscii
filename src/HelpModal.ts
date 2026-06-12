/*
  MapSCII - Terminal Map Viewer
  Help Modal Module

  Displays a beautiful ASCII help overlay
*/

import config from './config';
import { term } from './InputHandler';

export interface HelpContext {
    center: { lat: number; lon: number };
    zoom: number;
    width: number;
    height: number;
}

/**
 * Draw the help modal at the current terminal size
 */
function drawHelpModal(context: HelpContext): void {
  const rows = config.output.rows;
  const cols = config.output.columns;

  // Calculate center position for the popup
  const boxWidth = 52;
  const boxHeight = 38;
  const startX = Math.max(1, Math.floor((cols - boxWidth) / 2));
  const startY = Math.max(1, Math.floor((rows - boxHeight) / 2));

  // Draw box with border
  const topBorder = '╭' + '─'.repeat(boxWidth - 2) + '╮';
  const bottomBorder = '╰' + '─'.repeat(boxWidth - 2) + '╯';

  // Prepare content
  const mode = config.useBraille ? 'Braille' : 'Block';
  const centerStr = `${context.center.lat.toFixed(4)}, ${context.center.lon.toFixed(4)}`;
  const zoomStr = context.zoom.toFixed(1);
  const sizeStr = `${context.width}x${context.height}`;
  const cellGeo = `${config.cellGeometry.width}x${config.cellGeometry.height}`;

  // Content lines - full ASCII art and info
  const content = [
    '• ▌ ▄ ·.  ▄▄▄·  ▄▄▄·.▄▄ ·  ▄▄· ▪  ▪',
    '·██ ▐███▪▐█ ▀█ ▐█ ▄█▐█ ▀. ▐█ ▌▪██ ██',
    '▐█ ▌▐▌▐█·▄█▀▀█  ██▀·▄▀▀▀█▄██ ▄▄▐█·▐█·',
    '██ ██▌▐█▌▐█ ▪▐▌▐█▪·•▐█▄▪▐█▐███▌▐█▌▐█▌',
    '▀▀  █▪▀▀▀ ▀  ▀ .▀    ▀▀▀▀ ·▀▀▀ ▀▀▀▀▀▀',
    '',
    'MapSCII - The whole world in your console.',
    '',
    'made with <3 at',
    'https://github.com/rastapasta/mapscii',
    '',
    'map data (c) OpenStreetMap contributors',
    '',
    '┌──────────── Map Info ────────────┐',
    `│ Center     │ ${centerStr.padEnd(19)} │`,
    `│ Zoom       │ ${zoomStr.padEnd(19)} │`,
    `│ Mode       │ ${mode.padEnd(19)} │`,
    `│ Size       │ ${sizeStr.padEnd(19)} │`,
    `│ Cell       │ ${cellGeo.padEnd(19)} │`,
    '└──────────────────────────────────┘',
    '',
    '┌──────────── Controls ────────────┐',
    '│ Arrows/hjkl│ Navigate map        │',
    '│ a          │ Zoom in             │',
    '│ z          │ Zoom out            │',
    '│ / or s     │ Search location     │',
    '│ g          │ Go to your location │',
    '│ o          │ 3D Globe view       │',
    '│ c          │ Toggle render mode  │',
    '│ t          │ Toggle labels (min) │',
    '│ m          │ Clear markers       │',
    '│ ?          │ Show this help      │',
    '│ q          │ Quit                │',
    '└──────────────────────────────────┘',
    '',
    'Press any key to continue...',
  ];

  // Draw box with background fill for each line (overlay on top of map)
  term.saveCursor();

  // Draw box with content
  term.moveTo(startX, startY);
  term.bgBlack.gray(topBorder);

  for (let i = 0; i < boxHeight - 2; i++) {
    term.moveTo(startX, startY + 1 + i);
    const line = i < content.length ? content[i] : '';
    // Center the line within the box
    const padding = Math.max(0, Math.floor((boxWidth - 2 - line.length) / 2));
    term.bgBlack.gray('│');
    term.bgBlack.styleReset();
    term.bgBlack(' '.repeat(padding));
    // Color the logo lines
    if (i < 5) {
      term.bgBlack.cyan(line);
    } else if (line.includes('github.com')) {
      term.bgBlack.blue(line);
    } else if (line.includes('OpenStreetMap')) {
      term.bgBlack.dim(line);
    } else {
      term.bgBlack.white(line);
    }
    const remaining = boxWidth - 2 - padding - line.length;
    term.bgBlack(' '.repeat(Math.max(0, remaining)));
    term.bgBlack.gray('│');
  }

  term.moveTo(startX, startY + boxHeight - 1);
  term.bgBlack.gray(bottomBorder);
  term.styleReset();

  term.restoreCursor();
}

/**
 * Show the help modal overlay
 * Returns a promise that resolves when the user dismisses the modal
 */
export function showHelpModal(context: HelpContext): Promise<void> {
  // Initial draw
  drawHelpModal(context);

  // Wait for keypress
  return new Promise<void>((resolve) => {
    // Handle resize
    const resizeHandler = () => {
      drawHelpModal(context);
    };
    config.output.on('resize', resizeHandler);

    const keyHandler = () => {
      term.off('key', keyHandler);
      config.output.off('resize', resizeHandler);
      resolve();
    };
    term.on('key', keyHandler);
  });
}
