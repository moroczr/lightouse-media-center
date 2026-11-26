import type { KeyboardEvent } from 'react'

function resultColumns(list: HTMLUListElement, grid: boolean) {
  return grid ? getComputedStyle(list).gridTemplateColumns.trim().split(/\s+/).length : 1
}

export function navigateResultList(
  event: KeyboardEvent<HTMLElement>, list: HTMLUListElement | null, selectedIndex: number, grid: boolean,
  onBoundary?: (direction: -1 | 1) => void,
) {
  if (!list?.childElementCount || event.ctrlKey) return
  const { key, target } = event
  const inResults = target instanceof Node && list.contains(target)
  const vertical = key === 'ArrowUp' || key === 'ArrowDown'
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight'
  if (!vertical && !(grid && inResults && horizontal)) return

  event.preventDefault()
  const last = list.childElementCount - 1
  let index = selectedIndex
  if (index < 0) {
    index = key === 'ArrowUp' ? last : 0
  } else if (inResults) {
    const columns = resultColumns(list, grid)
    const column = index % columns
    if (key === 'ArrowUp' && index >= columns) index -= columns
    if (key === 'ArrowDown' && index - column + columns <= last) index = Math.min(index + columns, last)
    if (key === 'ArrowLeft' && column > 0) index--
    if (key === 'ArrowRight' && column + 1 < columns && index < last) index++
  }

  if (inResults && index === selectedIndex && onBoundary) {
    if (index === 0 && (key === 'ArrowUp' || key === 'ArrowLeft')) return onBoundary(-1)
    if (index === last && (key === 'ArrowDown' || key === 'ArrowRight')) return onBoundary(1)
  }

  const button = list.children[index]?.querySelector<HTMLButtonElement>('[data-result-button]')
  button?.focus({ preventScroll: true })
  button?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}
