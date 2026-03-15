import { createElement } from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';

const h = createElement;

export function Panel({ label, color, focused, lines, height, width, phaseColor, badge, isActive }) {
  const borderColor = focused ? 'white' : color;
  const borderStyle = focused ? 'double' : 'single';
  const activeIndicator = isActive ? chalk.bold[phaseColor || 'green'](' *') : '';
  const badgeText = badge ? chalk[badge.color || 'gray'](' [' + badge.text + ']') : '';

  return h(Box, {
    borderStyle,
    borderColor,
    height,
    width,
    flexDirection: 'column',
    overflow: 'hidden',
    flexShrink: 0,
    flexGrow: 0,
  },
    h(Text, { bold: focused, color: borderColor, wrap: 'truncate' },
      (focused ? '\u25B8 ' : '') + label + badgeText + activeIndicator
    ),
    ...(lines || []).map((line, i) =>
      h(Text, { key: String(i), wrap: 'truncate' }, line || ' ')
    )
  );
}
