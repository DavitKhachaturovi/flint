/**
 * The tick of Flint's checkbox (D-141 Q8): one path for the task row (`CheckIcon`) and the note's
 * checkbox, centred by the box's geometry (flex), never by hand-tuned margins.
 */
export const CHECK_PATH = 'm5 12.5 4.5 4.5L19 7.5';
export const CHECK_STROKE = 2.6;

/** The tick as an SVG element, for code outside React (the note editor's widgets). */
export function checkSvg(size: number): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [name, value] of Object.entries({
    width: String(size),
    height: String(size),
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': String(CHECK_STROKE),
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  }))
    svg.setAttribute(name, value);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', CHECK_PATH);
  svg.append(path);
  return svg;
}
