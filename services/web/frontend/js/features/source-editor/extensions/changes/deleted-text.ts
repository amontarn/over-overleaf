export const deletedTextTheme = {
  '&light .ol-cm-change-d': {
    backgroundColor: 'rgba(197, 6, 11, 0.18)',
    color: '#8f090d',
  },
  '&dark .ol-cm-change-d': {
    backgroundColor: 'rgba(255, 98, 105, 0.22)',
    color: '#ff9da2',
  },
  '.ol-cm-change-d': {
    borderRadius: '2px',
    textDecorationLine: 'line-through',
    textDecorationThickness: '2px',
    whiteSpace: 'pre-wrap',
  },
  '&light .ol-cm-change-d-highlight, &light .ol-cm-change-d-focus': {
    backgroundColor: 'rgba(197, 6, 11, 0.32)',
  },
  '&dark .ol-cm-change-d-highlight, &dark .ol-cm-change-d-focus': {
    backgroundColor: 'rgba(255, 98, 105, 0.36)',
  },
} as const

export const createDeletedTextElement = (deletedText: string) => {
  const element = document.createElement('del')
  element.classList.add('ol-cm-change', 'ol-cm-change-d')
  element.textContent = deletedText
  return element
}
