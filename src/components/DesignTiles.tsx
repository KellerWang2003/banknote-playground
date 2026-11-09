/**
 * Copies of a banknote's design laid edge to edge, as its neighbours on the print sheet, each cut to the banknote as it
 * shows on it (`object-fit: cover`, over the banknote's colour): the copies in columns and rows −1 to 1 around the
 * banknote's own at (0, 0). Whatever holds them clips them to what should show.
 */
export function DesignTiles({ url, width, height, color }: {
  url: string
  /** The banknote's size, px */
  width: number
  height: number
  color: string
}) {
  return [-1, 0, 1].flatMap((row) => [-1, 0, 1].map((column) => (
    <img key={`${column},${row}`} src={url} alt="" draggable={false} className="absolute max-w-none object-cover"
      style={{ left: column * width, top: row * height, width, height, backgroundColor: color }} />
  )))
}
