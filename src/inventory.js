export const BALL_COLORS = [
  '#ff4757', '#2ed573', '#1e90ff', '#ffa502', '#9b59b6', '#ff6b81', '#00d2d3'
];

export function createStarterInventory() {
  const ballColor = BALL_COLORS[Math.floor(Math.random() * BALL_COLORS.length)];
  return [
    {
      id: 'ball',
      name: 'Bouncy Ball',
      description: 'Throw for your companion to fetch.',
      icon: '🎾',
      color: ballColor
    },
    {
      id: 'tic-tac-toe',
      name: 'Oversized Tic-Tac-Toe',
      description: 'Unfurl a giant game board on the grass.',
      icon: '🎯'
    }
  ];
}
