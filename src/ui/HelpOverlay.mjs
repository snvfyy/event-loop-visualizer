import { createElement } from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';

const h = createElement;

export function HelpOverlay({ width, height }) {
  const helpContent = [
    '',
    chalk.bold.cyan('  EVENT LOOP VISUALIZER - HELP'),
    chalk.gray('  ' + '\u2500'.repeat(40)),
    '',
    chalk.bold('  NAVIGATION'),
    '    ' + chalk.yellow('\u2190 / h') + '    Previous step',
    '    ' + chalk.yellow('\u2192 / l') + '    Next step',
    '    ' + chalk.yellow('\u2191 / k') + '    Scroll up (focused panel)',
    '    ' + chalk.yellow('\u2193 / j') + '    Scroll down (focused panel)',
    '    ' + chalk.yellow('Tab') + '       Cycle panel focus',
    '    ' + chalk.yellow('Shift+Tab') + ' Reverse cycle focus',
    '',
    chalk.bold('  PLAYBACK'),
    '    ' + chalk.yellow('Space') + '     Play/Pause automatic stepping',
    '    ' + chalk.yellow('+') + '         Increase speed (faster)',
    '    ' + chalk.yellow('-') + '         Decrease speed (slower)',
    '    ' + chalk.yellow('r') + '         Reset to beginning',
    '',
    chalk.bold('  TESTS'),
    '    ' + chalk.yellow('n') + '         Jump to next test',
    '    ' + chalk.yellow('N') + '         Jump to previous test',
    '',
    chalk.bold('  OTHER'),
    '    ' + chalk.yellow('?') + '         Toggle this help',
    '    ' + chalk.yellow('q / Esc') + '   Quit',
    '',
    chalk.gray('  ' + '\u2500'.repeat(40)),
    '',
    chalk.bold('  EVENT LOOP PHASES'),
    '    ' + chalk.green('\u25CF Synchronous') + '   Main script execution',
    '    ' + chalk.cyan('\u25CF Microtasks') + '    Promise callbacks, queueMicrotask',
    '    ' + chalk.redBright('\u25CF Macrotasks') + '   setTimeout, setInterval callbacks',
    '',
    chalk.bold('  QUEUE INDICATORS'),
    '    ' + chalk.cyan('\u25CF') + ' Promise/then/await',
    '    ' + chalk.redBright('\u25D4') + ' setTimeout',
    '    ' + chalk.redBright('\u25D1') + ' setInterval',
    '    ' + chalk.cyan('\u25CB') + ' queueMicrotask',
    '    ' + chalk.magenta('\u25C8') + ' process.nextTick',
    '',
    chalk.gray.italic('  Press ? or Esc to close'),
  ];

  const boxWidth = Math.min(60, width - 4);
  const boxHeight = Math.min(helpContent.length + 2, height - 4);
  const paddingTop = Math.floor((height - boxHeight) / 2);
  const paddingLeft = Math.floor((width - boxWidth) / 2);

  const blankLines = new Array(height).fill(' '.repeat(width)).join('\n');

  return h(Box, {
    position: 'absolute',
    width: width,
    height: height,
    flexDirection: 'column',
  },
    h(Text, null, blankLines),
    h(Box, {
      position: 'absolute',
      marginLeft: paddingLeft,
      marginTop: paddingTop,
      width: boxWidth,
      height: boxHeight,
      borderStyle: 'double',
      borderColor: 'cyan',
      flexDirection: 'column',
    },
      h(Text, { wrap: 'truncate' }, helpContent.slice(0, boxHeight - 2).join('\n'))
    )
  );
}
