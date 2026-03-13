// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import AboutSection from '../../components/pages/Settings/AboutSection';

describe('AboutSection', () => {
  beforeEach(() => {
    (window as unknown as Record<string, unknown>).launcher = {
      updater: {
        getVersion: vi.fn().mockResolvedValue('4.0.0'),
      },
    };
  });

  it('renders the launcher title', () => {
    render(<AboutSection />);
    expect(screen.getByText('StarMade Launcher')).toBeInTheDocument();
  });

  it('renders the version number', async () => {
    render(<AboutSection />);
    expect(await screen.findByText('Version 4.0.0')).toBeInTheDocument();
  });

  it('renders the "Credits & Information" heading', () => {
    render(<AboutSection />);
    expect(screen.getByText('Credits & Information')).toBeInTheDocument();
  });

  it('renders the Official Website link', () => {
    render(<AboutSection />);
    const link = screen.getByText('Official Website').closest('a');
    expect(link).toHaveAttribute('href', 'https://www.star-made.org/');
  });

  it('renders the Community Discord link', () => {
    render(<AboutSection />);
    const link = screen.getByText('Community Discord').closest('a');
    expect(link).toHaveAttribute('href', 'https://discord.gg/SXbkYpU');
  });

  it('opens external links in a new tab with rel=noopener noreferrer', () => {
    render(<AboutSection />);
    const links = screen.getAllByRole('link');
    links
      .filter(link => link.getAttribute('href') !== '#')
      .forEach(link => {
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      });
  });

  it('renders the author credits at the bottom', () => {
    render(<AboutSection />);
    expect(screen.getByText('Created by DukeofRealms')).toBeInTheDocument();
    expect(screen.getByText('Happy building, citizens!')).toBeInTheDocument();
  });
});
