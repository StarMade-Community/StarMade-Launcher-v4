// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import MemorySlider from '../../components/common/MemorySlider';

const MIN = 4096;
const MAX = 16384;
const STEP = 1024;

describe('MemorySlider', () => {
  it('renders the current value in the number input', () => {
    render(<MemorySlider value={4096} onChange={vi.fn()} />);
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    expect(input.value).toBe('4096');
  });

  it('renders the "MB" label', () => {
    render(<MemorySlider value={4096} onChange={vi.fn()} />);
    expect(screen.getByText('MB')).toBeInTheDocument();
  });

  it('calls onChange with the new value when the number input changes', () => {
    const onChange = vi.fn();
    render(<MemorySlider value={4096} onChange={onChange} />);
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '8192' } });
    expect(onChange).toHaveBeenCalledWith(8192);
  });

  it('clamps values below MIN_MEMORY to MIN_MEMORY on number input change', () => {
    const onChange = vi.fn();
    render(<MemorySlider value={4096} onChange={onChange} />);
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '512' } });
    expect(onChange).toHaveBeenCalledWith(MIN);
  });

  it('clamps values above MAX_MEMORY to MAX_MEMORY on number input change', () => {
    const onChange = vi.fn();
    render(<MemorySlider value={4096} onChange={onChange} />);
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '99999' } });
    expect(onChange).toHaveBeenCalledWith(MAX);
  });

  it('snaps values to the nearest step size', () => {
    const onChange = vi.fn();
    render(<MemorySlider value={4096} onChange={onChange} />);
    const input = screen.getByRole('spinbutton');
    // 4500 should snap to 4096 (nearest 1024-aligned value)
    fireEvent.change(input, { target: { value: '4500' } });
    expect(onChange).toHaveBeenCalledWith(4096);
  });

  it('calls onChange when the range slider changes', () => {
    const onChange = vi.fn();
    render(<MemorySlider value={4096} onChange={onChange} />);
    const slider = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '6144' } });
    expect(onChange).toHaveBeenCalledWith(6144);
  });

  it('renders memory markers (4GB through 16GB)', () => {
    render(<MemorySlider value={4096} onChange={vi.fn()} />);
    // Markers at 4GB, 6GB, ... 16GB
    for (let mb = MIN; mb <= MAX; mb += 4096) {
      expect(screen.getByText(`${mb / 1024}GB`)).toBeInTheDocument();
    }
  });

  it('does not call onChange for non-numeric input', () => {
    const onChange = vi.fn();
    render(<MemorySlider value={4096} onChange={onChange} />);
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(onChange).not.toHaveBeenCalled();
  });
});
