// @vitest-environment jsdom
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { EdgeMarks } from '../src/editor/ContinuousView'
import { createNote } from '../src/lib/notes'

afterEach(cleanup)

describe('the continuous check on the canvas', () => {
  it('draws no dashed line round the banknote, whatever the cut tolerance', () => {
    const note = { ...createNote({ name: 'Cut', x: 0, y: 0, widthMm: 100, heightMm: 50, color: '#123456' }), continuous: { cutMm: 1 } }
    const { container } = render(<EdgeMarks note={note} scale={2} quiet={false} />)
    // Only the amber bars where the edges break, and this design has none to read yet (Keller took the line out)
    expect(container.querySelector('[data-edge-marks]')!.children).toHaveLength(0)
  })
})
